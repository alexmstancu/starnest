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
    Run,
    RunningSpend,
    RunScope,
    RunStatus,
    RunStore,
    SourceAdapter,
    SpendCapNotSetError,
    UnansweredItem,
    ask_again,
    retry_run,
)
from starnest.data_acquisition.execution import _AskedOnlyAbout

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
            StubSource("llm", (OVERBURDEN,), charges=True), frozenset({OVERBURDEN})
        )

        assert wrapped.costs_money is True

    def test_it_gives_the_estimate_of_the_source_it_wraps(self) -> None:
        wrapped = _AskedOnlyAbout(
            StubSource("llm", (OVERBURDEN,), charges=True), frozenset({OVERBURDEN})
        )

        assert wrapped.estimate_for(4) == A_PRICED_CALL

    def test_a_free_source_stays_free_through_the_wrapper(self) -> None:
        """The control: the defaults it used to inherit are the right answer here, and a fix
        that forwarded nothing would pass the two tests above and fail this one."""
        wrapped = _AskedOnlyAbout(StubSource("eurostat", (OVERBURDEN,)), frozenset({OVERBURDEN}))

        assert wrapped.costs_money is False
        assert wrapped.estimate_for(4) == Estimate()

    def test_it_still_narrows_the_attributes_to_what_failed(self) -> None:
        """What the wrapper exists for, which no fix may cost."""
        wrapped = _AskedOnlyAbout(
            StubSource("eurostat", (OVERBURDEN, OVERCROWDING)), frozenset({OVERCROWDING})
        )

        assert wrapped.attributes == (OVERCROWDING,)

    def test_it_hands_the_running_meter_to_the_source_it_wraps(self) -> None:
        """BE-10. Inherited, `meter_with` was the base class's no-op, so a source asked again
        never learned of the retry's meter -- the one hook P91 added for the cap to bite between
        candidates rather than between attributes."""
        paid = PaidPerCandidate((OVERBURDEN,))
        meter = CostMeter(cap_eur=Decimal(1))

        _AskedOnlyAbout(paid, frozenset({OVERBURDEN})).meter_with(meter)

        assert paid.meter is meter

    def test_it_overrides_every_member_the_base_class_defines(self) -> None:
        """**The guard BE-10 needed.** P41 made the wrapper forward members one at a time, then
        P91 gave the base a new hook with a working default and nothing noticed the wrapper
        inheriting it. A member added to `SourceAdapter` fails here until the wrapper forwards
        it as well."""
        defined = {name for name in vars(SourceAdapter) if not name.startswith("_")}
        overridden = {name for name in vars(_AskedOnlyAbout) if not name.startswith("_")}

        assert defined - overridden == set()


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
