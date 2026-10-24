"""Retrying what failed, and what a retry is allowed to cost (`reqs.md` 6.4, 6.3).

**The retry path was the least-tested route in the application** (P41, P42). `retry_run` was
exercised only through the acceptance suite, whose sources are free stubs, so nothing ever asked
the two questions that matter once a source charges: does a narrowed source still say that it
charges, and does a retry refuse to spend without a cap.

Both answers were no. `_AskedOnlyAbout` forwarded three members of `SourceAdapter` and inherited
the rest, and the base declares `costs_money = False` and an estimate of nothing -- safe defaults
for a new adapter, wrong for a wrapper, and wrong in the direction of spending money. Meanwhile
`retry_run` and `ask_again` took no cap at all, so `execute_run` fell back to `None`.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    DataSourceId,
    Ratio,
    RatioParameters,
    ReferencePeriod,
    StandIn,
    Value,
    ValueType,
)
from starnest.data_acquisition import (
    Acquired,
    AcquisitionFailure,
    CostMeter,
    Estimate,
    NothingToFetchError,
    Run,
    RunningSpend,
    RunScope,
    RunStatus,
    RunStore,
    SourceAdapter,
    SpendCapNotSetError,
    UnansweredItem,
    ask_again,
    execute_run,
    retry_run,
)
from starnest.data_acquisition.execution import _AskedOnlyAbout, _FailedOn


def _only_about(attributes, candidates=("country.portugal",)) -> _FailedOn:
    """A `_FailedOn` for the wrapper tests, which care about one dimension at a time -- so the
    pairs are the product of the attributes and candidates given."""
    return _FailedOn(pairs=frozenset((a, c) for a in attributes for c in candidates))


COUNTRY = {"id": "country", "depth_order": 1}
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")
GREECE = Candidate(id="country.greece", name="Greece", level=COUNTRY, country_code="GR")

A_PRICED_CALL = Estimate(calls=4, cost_eur=Decimal("0.40"), basis="4 calls at 0.10 EUR")


def an_attribute(identifier: str) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


class StubSource(SourceAdapter):
    """A source that answers nothing and records what it was asked, priced or free."""

    def __init__(self, source: str, declares: tuple[str, ...], *, charges: bool = False) -> None:
        self._source = source
        self._declares = declares
        self._charges = charges
        self.asked: list[str] = []

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._source)

    @property
    def costs_money(self) -> bool:
        return self._charges

    def estimate_for(self, items: int) -> Estimate:
        return A_PRICED_CALL if self._charges else Estimate()

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        self.asked.append(str(attribute.id))
        return Acquired(values=(), cost_eur=Decimal("0.10") if self._charges else Decimal(0))


class PaidPerCandidate(SourceAdapter):
    """A source billing one call per candidate and keeping its own account on the run's meter.

    The shape of the two LLM adapters (P91): handed the meter through `meter_with`, it records
    each call as it makes it and asks nothing once the meter is exhausted. And like them it is
    one instance for the life of the application, so the meter it holds is whichever it was
    handed last.
    """

    def __init__(self, declares: tuple[str, ...], *, eur_per_call: str = "1.00") -> None:
        self._declares = declares
        self._eur_per_call = Decimal(eur_per_call)
        self.meter: RunningSpend | None = None
        self.asked_about: list[str] = []
        self.asked_pairs: list[tuple[str, str]] = []

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("llm")

    @property
    def costs_money(self) -> bool:
        return True

    def estimate_for(self, items: int) -> Estimate:
        return Estimate(calls=items, cost_eur=items * self._eur_per_call, basis="a flat rate")

    @property
    def attributes(self) -> tuple:
        return self._declares

    def meter_with(self, meter: RunningSpend) -> None:
        self.meter = meter

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        failures: list[AcquisitionFailure] = []
        cost, calls = Decimal(0), 0
        for candidate in candidates:
            if self.meter is not None and self.meter.is_exhausted:
                failures.append(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        candidate=str(candidate.id),
                        reason="the run reached its spend cap before this candidate was asked",
                    )
                )
                continue
            self.asked_about.append(str(candidate.id))
            self.asked_pairs.append((str(attribute.id), str(candidate.id)))
            cost, calls = cost + self._eur_per_call, calls + 1
            if self.meter is not None:
                self.meter.spent(cost_eur=self._eur_per_call, calls=1)
        return Acquired(failures=tuple(failures), cost_eur=cost, calls=calls)


class RecordingValueStore:
    def __init__(self, holds: tuple = ()) -> None:
        self.appended: list[object] = []
        self._holds = holds

    async def append(self, values):  # type: ignore[no-untyped-def]
        self.appended.extend(values)
        return tuple(values)

    async def record_reuse(self, run, data_source, pairs):  # type: ignore[no-untyped-def]
        return None

    async def read_observations(self, values):  # type: ignore[no-untyped-def]
        """Nothing this fake appends is ever a no-op, so nothing is on record to compare."""
        return ()

    async def read_active_values(self, *, candidates=None, attributes=None):  # type: ignore[no-untyped-def]
        """What the stand-in step reads to find a figure worth borrowing."""
        return self._holds


class RecordingRunStore(RunStore):
    def __init__(self, answers_with: Run) -> None:
        self._answers_with = answers_with
        self.opened: list[RunScope] = []

    async def start_run(self, scope: RunScope, *, triggered_by: str) -> int:
        self.opened.append(scope)
        return 900 + len(self.opened)

    async def finish_run(self, run: int, *, status: RunStatus, finished_at: datetime) -> None:
        return None

    async def record_failures(self, run, failures) -> None:  # type: ignore[no-untyped-def]
        return None

    async def request_stop(self, run: int) -> bool:
        """Nothing here runs long enough to stop. Implemented because the port declares it."""
        return False

    async def stop_was_requested(self, run: int) -> bool:
        return False

    async def add_spend(self, run: int, *, calls: int, cost_eur: Decimal) -> None:
        return None

    async def record_research_spend(self, spend) -> None:  # type: ignore[no-untyped-def]
        """No gate is researched by a retry. Implemented because the port declares it."""
        return None

    async def read_run(self, run: int) -> Run:
        return self._answers_with

    async def read_runs(self, *, limit: int = 20, offset: int = 0) -> tuple[Run, ...]:
        return ()

    async def count_runs(self) -> int:
        return 0

    async def last_retrieved(self, *, level=None, candidates=(), attributes=()):
        """Nothing was ever asked about, so nothing is fresh and nothing is skipped."""
        return {}

    async def run_in_flight(self) -> int | None:
        """Nothing is in flight here: these tests call the domain directly, and the one-run-at-
        a-time rule is the API's to enforce (P35). Implemented because the port declares it."""
        return None

    async def sweep_abandoned_runs(self, *, finished_at: datetime) -> tuple[int, ...]:
        return ()


THE_SCOPE = RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,))


def a_failed_run(source: str = "llm") -> Run:
    return Run(
        id=17,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=THE_SCOPE,
        failures=(
            AcquisitionFailure(
                attribute=OVERBURDEN,
                reason="the model could not be reached",
                candidate="country.portugal",
                data_source=DataSourceId(source),
            ),
        ),
    )


def a_run_with_nothing_answered(source: str = "llm") -> Run:
    return Run(
        id=18,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=THE_SCOPE,
        unanswered=(UnansweredItem(candidate="country.portugal", attribute=OVERBURDEN),),
    )


async def retrying(source: StubSource, **spend: object) -> Run:
    return await retry_run(
        failed=a_failed_run(str(source.data_source)),
        adapters=[source],
        attributes=[an_attribute(OVERBURDEN)],
        candidates=[PORTUGAL],
        values=RecordingValueStore(),
        runs=RecordingRunStore(answers_with=a_failed_run()),
        **spend,  # type: ignore[arg-type]
    )


def a_run_the_paid_source_failed_for(*candidates: Candidate) -> Run:
    """One failure per candidate, every one of them the paid source's."""
    return Run(
        id=20,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=RunScope(
            level="country",
            candidates=tuple(str(candidate.id) for candidate in candidates),
            attributes=(OVERBURDEN,),
        ),
        failures=tuple(
            AcquisitionFailure(
                attribute=OVERBURDEN,
                reason="the model could not be reached",
                candidate=str(candidate.id),
                data_source=DataSourceId("llm"),
            )
            for candidate in candidates
        ),
    )


async def retrying_the_paid_source(
    source: PaidPerCandidate, *candidates: Candidate, cap: Decimal
) -> Run:
    failed = a_run_the_paid_source_failed_for(*candidates)
    return await retry_run(
        failed=failed,
        adapters=[source],
        attributes=[an_attribute(OVERBURDEN)],
        candidates=list(candidates),
        values=RecordingValueStore(),
        runs=RecordingRunStore(answers_with=failed),
        spend_cap_eur=cap,
    )


LIECHTENSTEIN = Candidate(
    id="country.liechtenstein", name="Liechtenstein", level=COUNTRY, country_code="LI"
)
SWITZERLAND = Candidate(
    id="country.switzerland", name="Switzerland", level=COUNTRY, country_code="CH"
)

BORROWS_FROM_SWITZERLAND = StandIn(
    candidate="country.liechtenstein",
    candidate_name="Liechtenstein",
    attribute=OVERBURDEN,
    substitute="country.switzerland",
    substitute_name="Switzerland",
    reason="no source covers Liechtenstein for this",
)


def a_run_the_stand_in_step_failed(source: str = "stand_in") -> Run:
    """The only failure came from borrowing, not from any source (P51)."""
    return Run(
        id=19,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=RunScope(
            level="country",
            candidates=("country.liechtenstein",),
            attributes=(OVERBURDEN,),
        ),
        failures=(
            AcquisitionFailure(
                attribute=OVERBURDEN,
                reason="Switzerland stands in for Liechtenstein here, and has no figure of "
                "its own to lend",
                candidate="country.liechtenstein",
                data_source=DataSourceId(source),
            ),
        ),
    )


async def asking_again(source: StubSource, **spend: object) -> Run:
    return await ask_again(
        run=a_run_with_nothing_answered(str(source.data_source)),
        adapters=[source],
        attributes=[an_attribute(OVERBURDEN)],
        candidates=[PORTUGAL],
        values=RecordingValueStore(),
        runs=RecordingRunStore(answers_with=a_run_with_nothing_answered()),
        **spend,  # type: ignore[arg-type]
    )


class TestTheNarrowedSource:
    """`_AskedOnlyAbout` is a decorator, and a decorator that forwards some of its subject is
    worse than none: the parts it forgets answer with the base class's defaults, which describe
    a different source entirely."""

    def test_it_says_what_the_source_it_wraps_charges(self) -> None:
        wrapped = _AskedOnlyAbout(
            StubSource("llm", (OVERBURDEN,), charges=True), _only_about({OVERBURDEN})
        )

        assert wrapped.costs_money is True

    def test_it_gives_the_estimate_of_the_source_it_wraps(self) -> None:
        wrapped = _AskedOnlyAbout(
            StubSource("llm", (OVERBURDEN,), charges=True), _only_about({OVERBURDEN})
        )

        assert wrapped.estimate_for(4) == A_PRICED_CALL

    def test_a_free_source_stays_free_through_the_wrapper(self) -> None:
        """The control: the defaults it used to inherit are the right answer here, and a fix
        that forwarded nothing would pass the two tests above and fail this one."""
        wrapped = _AskedOnlyAbout(StubSource("eurostat", (OVERBURDEN,)), _only_about({OVERBURDEN}))

        assert wrapped.costs_money is False
        assert wrapped.estimate_for(4) == Estimate()

    def test_it_still_narrows_the_attributes_to_what_failed(self) -> None:
        """What the wrapper exists for, which no fix may cost."""
        wrapped = _AskedOnlyAbout(
            StubSource("eurostat", (OVERBURDEN, OVERCROWDING)), _only_about({OVERCROWDING})
        )

        assert wrapped.attributes == (OVERCROWDING,)

    def test_it_hands_the_running_meter_to_the_source_it_wraps(self) -> None:
        """BE-10. Inherited, `meter_with` was the base class's no-op, so a source asked again
        never learned of the retry's meter -- the one hook P91 added for the cap to bite between
        candidates rather than between attributes."""
        paid = PaidPerCandidate((OVERBURDEN,))
        meter = CostMeter(cap_eur=Decimal(1))

        _AskedOnlyAbout(paid, _only_about({OVERBURDEN})).meter_with(meter)

        assert paid.meter is meter

    def test_it_overrides_every_member_the_base_class_defines(self) -> None:
        """**The guard BE-10 needed.** P41 made the wrapper forward members one at a time, then
        P91 gave the base a new hook with a working default and nothing noticed the wrapper
        inheriting it. A member added to `SourceAdapter` fails here until the wrapper forwards
        it as well."""
        defined = {name for name in vars(SourceAdapter) if not name.startswith("_")}
        overridden = {name for name in vars(_AskedOnlyAbout) if not name.startswith("_")}

        assert defined - overridden == set()


class TestARetryAsksEachSourceOnlyAboutItsOwnFailures:
    """BE-11, NEW-48. A retry's candidate list is the union of every source's failures, and a
    run fetches through `fetch_in_batches` (BE-19); a paid source billing per candidate must be
    narrowed there, or one source's failure pays again for a country another source answered."""

    async def test_a_paid_source_is_not_asked_about_another_sources_failed_candidate(
        self,
    ) -> None:
        paid = PaidPerCandidate((OVERBURDEN,))
        failed = Run(
            id=21,
            status=RunStatus.COMPLETED,
            started_at=datetime.now(UTC),
            triggered_by="user",
            scope=RunScope(
                level="country",
                candidates=(str(PORTUGAL.id), str(SPAIN.id)),
                attributes=(OVERBURDEN,),
            ),
            failures=(
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="503",
                    candidate=str(PORTUGAL.id),
                    data_source=DataSourceId("eurostat"),
                ),
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="the model could not be reached",
                    candidate=str(SPAIN.id),
                    data_source=DataSourceId("llm"),
                ),
            ),
        )

        await retry_run(
            failed=failed,
            adapters=[paid, StubSource("eurostat", (OVERBURDEN,))],
            attributes=[an_attribute(OVERBURDEN)],
            candidates=[PORTUGAL, SPAIN],
            values=RecordingValueStore(),
            runs=RecordingRunStore(answers_with=failed),
            spend_cap_eur=Decimal(10),
        )

        assert paid.asked_about == [str(SPAIN.id)]

    async def test_a_paid_source_is_asked_only_the_exact_pairs_it_failed_on(self) -> None:
        """BE-11. The scope was the rectangle of every failed attribute by every failed candidate,
        so a source that failed on (overburden, Portugal) and (overcrowding, Spain) was re-asked
        all four corners -- paying again for the two pairs it had answered. It is asked the two
        pairs it actually failed, and no more."""
        paid = PaidPerCandidate((OVERBURDEN, OVERCROWDING))
        failed = Run(
            id=22,
            status=RunStatus.COMPLETED,
            started_at=datetime.now(UTC),
            triggered_by="user",
            scope=RunScope(
                level="country",
                candidates=(str(PORTUGAL.id), str(SPAIN.id)),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
            failures=(
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="the model could not be reached",
                    candidate=str(PORTUGAL.id),
                    data_source=DataSourceId("llm"),
                ),
                AcquisitionFailure(
                    attribute=OVERCROWDING,
                    reason="the model could not be reached",
                    candidate=str(SPAIN.id),
                    data_source=DataSourceId("llm"),
                ),
            ),
        )

        await retry_run(
            failed=failed,
            adapters=[paid],
            attributes=[an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)],
            candidates=[PORTUGAL, SPAIN],
            values=RecordingValueStore(),
            runs=RecordingRunStore(answers_with=failed),
            spend_cap_eur=Decimal(10),
        )

        assert sorted(paid.asked_pairs) == [
            (OVERBURDEN, str(PORTUGAL.id)),
            (OVERCROWDING, str(SPAIN.id)),
        ]

    async def test_a_whole_source_outage_is_recorded_against_only_the_candidates_it_was_asked(
        self,
    ) -> None:
        """BE-11 (Astra). A source reached in a retry can fail wholesale, for no candidate in
        particular. Spread over every candidate the retry covers, it blamed a source for countries
        drawn from another source's failures and never asked of it. It is itemised over only the
        candidates this source was asked."""

        class FailsWholesale(SourceAdapter):
            @property
            def data_source(self) -> DataSourceId:
                return DataSourceId("eurostat")

            @property
            def attributes(self) -> tuple:
                return (OVERBURDEN,)

            async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]):
                return Acquired(
                    failures=(
                        AcquisitionFailure(attribute=attribute.id, candidate=None, reason="503"),
                    )
                )

        wrapped = _AskedOnlyAbout(FailsWholesale(), _only_about({OVERBURDEN}, (str(PORTUGAL.id),)))

        produced = await wrapped.fetch(an_attribute(OVERBURDEN), [PORTUGAL, SPAIN])

        assert [(f.attribute, f.candidate) for f in produced.failures] == [
            (OVERBURDEN, str(PORTUGAL.id))
        ]

    async def test_the_failures_of_a_raising_source_stay_inside_its_own_pairs(self) -> None:
        """PL-047. A source that crashes is charged with every candidate it was asked about and
        had not answered -- which, through the wrapper, is only its own failed pairs, never the
        candidates the retry drew from another source's failures."""

        class Crashes(SourceAdapter):
            @property
            def data_source(self) -> DataSourceId:
                return DataSourceId("eurostat")

            @property
            def attributes(self) -> tuple:
                return (OVERBURDEN,)

            async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]):
                raise KeyError("an unforeseen field")

        class KeepsFailures(RecordingRunStore):
            def __init__(self, answers_with: Run) -> None:
                super().__init__(answers_with)
                self.recorded: set[tuple[str, str | None, str | None]] = set()

            async def record_failures(self, run, failures) -> None:  # type: ignore[no-untyped-def]
                self.recorded |= {(f.attribute, f.candidate, f.data_source) for f in failures}

        failed = Run(
            id=23,
            status=RunStatus.COMPLETED,
            started_at=datetime.now(UTC),
            triggered_by="user",
            scope=RunScope(
                level="country",
                candidates=(str(PORTUGAL.id), str(SPAIN.id)),
                attributes=(OVERBURDEN,),
            ),
            failures=(
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="503",
                    candidate=str(PORTUGAL.id),
                    data_source=DataSourceId("eurostat"),
                ),
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="the model could not be reached",
                    candidate=str(SPAIN.id),
                    data_source=DataSourceId("llm"),
                ),
            ),
        )
        runs = KeepsFailures(answers_with=failed)

        with pytest.raises(KeyError):
            await retry_run(
                failed=failed,
                adapters=[Crashes(), StubSource("llm", (OVERBURDEN,))],
                attributes=[an_attribute(OVERBURDEN)],
                candidates=[PORTUGAL, SPAIN],
                values=RecordingValueStore(),
                runs=runs,
                spend_cap_eur=Decimal(10),
            )

        assert {(a, c) for a, c, source in runs.recorded if source == "eurostat"} == {
            (OVERBURDEN, str(PORTUGAL.id))
        }


class TestWhatARetryMaySpend:
    async def test_a_retry_of_a_paid_source_with_no_cap_is_refused(self) -> None:
        """The run that cost 2.70 EUR to discover was a first attempt. Nothing stopped its
        retry from costing the same again."""
        paid = StubSource("llm", (OVERBURDEN,), charges=True)

        with pytest.raises(SpendCapNotSetError):
            await retrying(paid, spend_cap_eur=None, uncapped_is_accepted=False)

        assert paid.asked == [], "refused before a single call was made"

    async def test_a_retry_of_a_paid_source_proceeds_under_a_cap(self) -> None:
        paid = StubSource("llm", (OVERBURDEN,), charges=True)

        await retrying(paid, spend_cap_eur=Decimal(5), uncapped_is_accepted=False)

        assert paid.asked == [OVERBURDEN]

    async def test_a_retry_may_be_accepted_uncapped_like_any_other_run(self) -> None:
        """Q220's bypass, per request. A refusal with no way past it is a wall."""
        paid = StubSource("llm", (OVERBURDEN,), charges=True)

        await retrying(paid, spend_cap_eur=None, uncapped_is_accepted=True)

        assert paid.asked == [OVERBURDEN]

    async def test_a_retry_of_free_sources_needs_no_cap(self) -> None:
        """Every source shipped today is free, and a cap is meaningless to them."""
        free = StubSource("eurostat", (OVERBURDEN,))

        await retrying(free, spend_cap_eur=None, uncapped_is_accepted=False)

        assert free.asked == [OVERBURDEN]

    async def test_a_retry_stops_a_per_candidate_sweep_at_the_cap(self) -> None:
        """BE-10. Handed the retry's meter, a source billing per candidate stops after the
        candidate that reached the cap, rather than after the whole attribute is paid for."""
        paid = PaidPerCandidate((OVERBURDEN,), eur_per_call="1.00")

        await retrying_the_paid_source(paid, PORTUGAL, SPAIN, GREECE, cap=Decimal("1.00"))

        assert paid.asked_about == [str(PORTUGAL.id)]

    async def test_a_meter_exhausted_by_an_earlier_run_does_not_refuse_a_retry(self) -> None:
        """The adapter lives as long as the application, so without the hand-over it kept the
        last run's meter -- and a run that had halted on its cap left one that refused every
        candidate of the next retry, however much that retry was allowed to spend."""
        paid = PaidPerCandidate((OVERBURDEN,))
        paid.meter_with(CostMeter(cap_eur=Decimal(1), spent_eur=Decimal(1)))

        await retrying_the_paid_source(paid, PORTUGAL, cap=Decimal(5))

        assert paid.asked_about == [str(PORTUGAL.id)]


class TestWhatARunHaltedOnItsCapLogs:
    """NEW-14, `arch.md` 9.4. A failure's log line is the only way a source's refusal is
    diagnosed afterwards, and the source that reached the cap returned before the loop writing
    those lines -- so the run most in need of explaining logged nothing it failed on.

    Here rather than beside `acquire` because a halt is the run's, and this file holds the run
    store and the paid source a halted run needs.
    """

    async def test_the_failures_of_the_source_that_reached_the_cap_are_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level("WARNING", logger="starnest.acquisition"):
            await execute_run(
                adapters=[PaidPerCandidate((OVERBURDEN,), eur_per_call="1.00")],
                attributes=[an_attribute(OVERBURDEN)],
                candidates=[PORTUGAL, SPAIN, GREECE],
                values=RecordingValueStore(),
                runs=RecordingRunStore(answers_with=a_failed_run()),
                level="country",
                spend_cap_eur=Decimal("1.00"),
            )

        assert "halted on its spend cap" in caplog.text
        for skipped in (SPAIN, GREECE):
            assert f"llm could not answer {OVERBURDEN} for {skipped.id}" in caplog.text


class TestWhatAskingAgainMaySpend:
    """The same question for Q217's other act. It asks *every* source that can answer rather
    than the one that failed, so if anything it reaches a paid source more readily."""

    async def test_asking_again_through_a_paid_source_with_no_cap_is_refused(self) -> None:
        paid = StubSource("llm", (OVERBURDEN,), charges=True)

        with pytest.raises(SpendCapNotSetError):
            await asking_again(paid, spend_cap_eur=None, uncapped_is_accepted=False)

        assert paid.asked == []

    async def test_asking_again_proceeds_under_a_cap(self) -> None:
        paid = StubSource("llm", (OVERBURDEN,), charges=True)

        await asking_again(paid, spend_cap_eur=Decimal(5), uncapped_is_accepted=False)

        assert paid.asked == [OVERBURDEN]


class TestRetryingWhatOnlyTheStandInStepFailed:
    """A borrow that found nothing to borrow is a failure worth going back to (P51).

    `stand_in` is not an adapter, so its failures carry a `data_source` no adapter declares and
    the retry narrowed itself to an empty list of sources -- which `execute_run` then refused
    with "nothing in this run's scope can be answered by the sources it may ask". True of the
    sources, and the sources were never what failed.

    **Retrying is not futile**: a substitute's figure that arrives in a later run is exactly
    what makes the borrow succeed the second time.
    """

    async def retrying(self, holds: tuple = ()) -> Run:
        return await retry_run(
            failed=a_run_the_stand_in_step_failed(),
            adapters=[StubSource("eurostat", (OVERBURDEN,))],
            attributes=[an_attribute(OVERBURDEN)],
            candidates=[LIECHTENSTEIN, SWITZERLAND],
            values=RecordingValueStore(holds=holds),
            runs=RecordingRunStore(answers_with=a_run_the_stand_in_step_failed()),
            stand_ins=[BORROWS_FROM_SWITZERLAND],
        )

    async def test_it_is_a_run_rather_than_a_refusal(self) -> None:
        assert await self.retrying() is not None

    async def test_the_borrow_is_attempted_again(self) -> None:
        """With the substitute's figure now stored, the retry lends it -- which is the whole
        point of going back to a stand-in failure."""
        switzerlands_figure = Value(
            candidate="country.switzerland",
            attribute=OVERBURDEN,
            value_type=ValueType.RATIO,
            data_source="eurostat",
            reference_period=ReferencePeriod(
                start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
            ),
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=Ratio(value=Decimal("11.4"), basis="households"),
        )
        store = RecordingValueStore(holds=(switzerlands_figure,))

        await retry_run(
            failed=a_run_the_stand_in_step_failed(),
            adapters=[StubSource("eurostat", (OVERBURDEN,))],
            attributes=[an_attribute(OVERBURDEN)],
            candidates=[LIECHTENSTEIN, SWITZERLAND],
            values=store,
            runs=RecordingRunStore(answers_with=a_run_the_stand_in_step_failed()),
            stand_ins=[BORROWS_FROM_SWITZERLAND],
        )

        borrowed = [
            value
            for value in store.appended
            if str(value.candidate) == "country.liechtenstein"  # type: ignore[attr-defined]
        ]
        assert len(borrowed) == 1

    async def test_a_retry_that_mixes_a_source_failure_and_a_borrow_keeps_the_borrow(self) -> None:
        """BE-11. `answerable or borrowable` kept the borrow only when no source had failed, so a
        retry of a source failure *and* a borrow failure dropped the borrow -- the one the
        household went back for. Both belong to the retry, and the borrow is still attempted."""
        switzerlands_figure = Value(
            candidate="country.switzerland",
            attribute=OVERBURDEN,
            value_type=ValueType.RATIO,
            data_source="eurostat",
            reference_period=ReferencePeriod(
                start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
            ),
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=Ratio(value=Decimal("11.4"), basis="households"),
        )
        store = RecordingValueStore(holds=(switzerlands_figure,))
        mixed = Run(
            id=23,
            status=RunStatus.COMPLETED,
            started_at=datetime.now(UTC),
            triggered_by="user",
            scope=RunScope(
                level="country",
                candidates=("country.spain", "country.liechtenstein"),
                attributes=(OVERCROWDING, OVERBURDEN),
            ),
            failures=(
                AcquisitionFailure(
                    attribute=OVERCROWDING,
                    reason="503",
                    candidate="country.spain",
                    data_source=DataSourceId("eurostat"),
                ),
                AcquisitionFailure(
                    attribute=OVERBURDEN,
                    reason="Switzerland had no figure of its own to lend",
                    candidate="country.liechtenstein",
                    data_source=DataSourceId("stand_in"),
                ),
            ),
        )

        await retry_run(
            failed=mixed,
            adapters=[StubSource("eurostat", (OVERCROWDING,))],
            attributes=[an_attribute(OVERCROWDING), an_attribute(OVERBURDEN)],
            candidates=[SPAIN, LIECHTENSTEIN],
            values=store,
            runs=RecordingRunStore(answers_with=mixed),
            stand_ins=[BORROWS_FROM_SWITZERLAND],
        )

        borrowed = [
            value
            for value in store.appended
            if str(value.candidate) == "country.liechtenstein"  # type: ignore[attr-defined]
        ]
        assert len(borrowed) == 1, "the borrow was dropped because a source also failed"


def a_swiss_figure(attribute: str) -> Value:
    """Switzerland's own figure for one attribute, stored earlier and so lendable."""
    return Value(
        candidate="country.switzerland",
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source="eurostat",
        reference_period=ReferencePeriod(
            start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
        ),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("11.4"), basis="households"),
    )


def a_run_failing_on(*failures: tuple[str, Candidate, str]) -> Run:
    """A finished run whose failures are the (source, candidate, attribute) triples given."""
    return Run(
        id=24,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=RunScope(
            level="country",
            candidates=tuple(dict.fromkeys(str(candidate.id) for _, candidate, _ in failures)),
            attributes=tuple(dict.fromkeys(attribute for _, _, attribute in failures)),
        ),
        failures=tuple(
            AcquisitionFailure(
                attribute=attribute,
                reason="the source could not answer",
                candidate=str(candidate.id),
                data_source=DataSourceId(source),
            )
            for source, candidate, attribute in failures
        ),
    )


class TestARetryBorrowsOnlyForItsOwnPairs:
    """FU-A1 (PL-042). A retry asks about the exact pairs it went back to (BE-11), and the borrow
    step still read the two lists those pairs span -- so every declared borrow inside that
    rectangle was written under the retry, though nobody had asked about it, and the run then
    counted more answers than it had items."""

    async def test_a_retry_borrows_only_for_the_exact_pairs_it_asked_about(self) -> None:
        """Liechtenstein borrows both attributes from Switzerland. The retry asks about its
        overburden rate and Portugal's overcrowding, so Liechtenstein's overcrowding -- a corner
        of the rectangle, not a pair -- is not this retry's to borrow."""
        failed = a_run_failing_on(
            ("eurostat", LIECHTENSTEIN, OVERBURDEN), ("oecd", PORTUGAL, OVERCROWDING)
        )
        store = RecordingValueStore(
            holds=(a_swiss_figure(OVERBURDEN), a_swiss_figure(OVERCROWDING))
        )

        await retry_run(
            failed=failed,
            adapters=[StubSource("eurostat", (OVERBURDEN,)), StubSource("oecd", (OVERCROWDING,))],
            attributes=[an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)],
            candidates=[LIECHTENSTEIN, PORTUGAL],
            values=store,
            runs=RecordingRunStore(answers_with=failed),
            stand_ins=[
                BORROWS_FROM_SWITZERLAND,
                BORROWS_FROM_SWITZERLAND.model_copy(update={"attribute": OVERCROWDING}),
            ],
        )

        borrowed = {
            (str(value.candidate), str(value.attribute))  # type: ignore[attr-defined]
            for value in store.appended
        }
        assert borrowed == {("country.liechtenstein", OVERBURDEN)}


class TestARetryRecordsOnlyWhatItCanReach:
    """FU-A2 (PL-043). A retry took its pairs from every failure of the run it retries and its
    sources from the ones still switched on, and never intersected the two. A failure of a
    source nobody will ask became an item no source was asked about -- reported unanswered for
    ever -- and when no failing source was left the refusal said that no source was switched on,
    while others were."""

    @pytest.mark.parametrize(
        "world_bank_declares",
        [None, (OVERCROWDING,)],
        ids=["its source is switched off or gone", "its source no longer declares it"],
    )
    async def test_a_failure_no_source_will_be_asked_about_is_not_an_item(
        self, world_bank_declares: tuple[str, ...] | None
    ) -> None:
        """World Bank's failure on Spain's overburden rate is a corner of the two Eurostat
        failures, so only the reach of its source can keep it out."""
        failed = a_run_failing_on(
            ("eurostat", PORTUGAL, OVERBURDEN),
            ("eurostat", SPAIN, OVERCROWDING),
            ("world_bank", SPAIN, OVERBURDEN),
        )
        runs = RecordingRunStore(answers_with=failed)
        world_bank = (
            [] if world_bank_declares is None else [StubSource("world_bank", world_bank_declares)]
        )

        await retry_run(
            failed=failed,
            adapters=[StubSource("eurostat", (OVERBURDEN, OVERCROWDING)), *world_bank],
            attributes=[an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)],
            candidates=[PORTUGAL, SPAIN],
            values=RecordingValueStore(),
            runs=runs,
        )

        assert runs.opened[0].pairs == (
            (str(PORTUGAL.id), OVERBURDEN),
            (str(SPAIN.id), OVERCROWDING),
        )

    @pytest.mark.parametrize(
        ("stand_ins", "items"),
        [
            ((), {(str(PORTUGAL.id), OVERBURDEN), ("country.liechtenstein", OVERCROWDING)}),
            (
                (BORROWS_FROM_SWITZERLAND,),
                {
                    (str(PORTUGAL.id), OVERBURDEN),
                    ("country.liechtenstein", OVERCROWDING),
                    ("country.liechtenstein", OVERBURDEN),
                },
            ),
        ],
        ids=["no stand-in is declared or enabled", "the stand-in is still declared"],
    )
    async def test_a_failed_borrow_is_an_item_only_while_its_stand_in_is_declared(
        self, stand_ins: tuple[StandIn, ...], items: set[tuple[str, str]]
    ) -> None:
        failed = a_run_failing_on(
            ("eurostat", PORTUGAL, OVERBURDEN),
            ("eurostat", LIECHTENSTEIN, OVERCROWDING),
            ("stand_in", LIECHTENSTEIN, OVERBURDEN),
        )
        runs = RecordingRunStore(answers_with=failed)

        await retry_run(
            failed=failed,
            adapters=[StubSource("eurostat", (OVERBURDEN, OVERCROWDING))],
            attributes=[an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)],
            candidates=[PORTUGAL, LIECHTENSTEIN],
            values=RecordingValueStore(),
            runs=runs,
            stand_ins=stand_ins,
        )

        assert set(runs.opened[0].pairs or ()) == items

    async def test_a_retry_with_nothing_it_can_reach_is_refused_and_says_why(self) -> None:
        """Eurostat is switched on; only World Bank failed, and it is switched off."""
        failed = a_run_failing_on(("world_bank", SPAIN, OVERBURDEN))
        runs = RecordingRunStore(answers_with=failed)

        with pytest.raises(NothingToFetchError) as refused:
            await retry_run(
                failed=failed,
                adapters=[StubSource("eurostat", (OVERBURDEN,))],
                attributes=[an_attribute(OVERBURDEN)],
                candidates=[SPAIN],
                values=RecordingValueStore(),
                runs=runs,
            )

        assert "no data source is switched on" not in str(refused.value)
        assert "switched off" in str(refused.value)
        assert runs.opened == []
