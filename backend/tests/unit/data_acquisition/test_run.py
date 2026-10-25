"""One acquisition run, over a source that is not the network.

The adapter under a run is a stub here on purpose: what is under test is what a *run* does with
whatever an adapter returns -- which attributes it asks about, what it stores, and what it does
when a fetch fails. Eurostat's own behaviour is tested where Eurostat lives.
"""

from collections.abc import AsyncIterator, Sequence
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
    Value,
    ValueType,
)
from starnest.data_acquisition import (
    Acquired,
    AcquisitionFailure,
    CostMeter,
    RunningSpend,
    SourceAdapter,
    acquire,
)

COUNTRY = {"id": "country", "depth_order": 1}
OVERBURDEN = "country.housing_cost_overburden_rate"
PRESS_FREEDOM = "country.press_freedom"
ENGLISH = "country.english_proficiency"


def an_attribute(identifier: str = OVERBURDEN) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")
GREECE = Candidate(id="country.greece", name="Greece", level=COUNTRY, country_code="GR")


def a_value(attribute: str = OVERBURDEN) -> Value:
    return Value(
        candidate="country.portugal",
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source="eurostat",
        reference_period=ReferencePeriod(
            start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
        ),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("6.3"), basis="households"),
    )


NOT_CREDIBLE = f"96.3 is outside the credible range 0..60 declared for {OVERBURDEN}"


def a_rejected_value() -> Value:
    """A figure stored with the attribute's verdict beside it, as `Measurements` builds one."""
    return a_value().model_copy(update={"rejection_reason": NOT_CREDIBLE})


class StubAdapter(SourceAdapter):
    """A source that answers whatever the test told it to, and records what it was asked."""

    def __init__(self, answers: dict[str, Acquired], declares: tuple[str, ...]) -> None:
        self._answers = answers
        self._declares = declares
        self.asked: list[str] = []

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("eurostat")

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        self.asked.append(str(attribute.id))
        return self._answers.get(str(attribute.id), Acquired())


class RecordingValueStore:
    """Just enough `ValueStore` to see what a run tried to append and re-confirm.

    `already_holds` lets a test say which figures are already on record, so `append` returns one
    sharing their natural key as a no-op the way the real store does for a re-read transcribed
    figure (ST-09), and `read_observations` hands back the figure on record -- which is what a
    run compares the re-read with (NEW-23). What `append` stores is on record from then on, as
    it is in the database, so a later read in the same run sees it."""

    def __init__(self, already_holds: Sequence[Value] = ()) -> None:
        self.appended: list[Value] = []
        self.reused: list[tuple[str, str]] = []
        self.reused_by: list[str] = []
        self.restated: dict[tuple[str, str], int | None] = {}
        self._on_record = {value.natural_key: value for value in already_holds}

    async def append(self, values):
        newly = []
        for value in values:
            if value.natural_key not in self._on_record:
                self._on_record[value.natural_key] = value
                newly.append(value)
        self.appended.extend(newly)
        return tuple(newly)

    async def read_observations(self, values):
        keys = {value.natural_key for value in values}
        return tuple(held for key, held in self._on_record.items() if key in keys)

    async def record_reuse(self, run, data_source, pairs) -> None:
        self.restated.update(pairs)
        pairs = list(pairs)
        self.reused.extend(pairs)
        self.reused_by.extend(str(data_source) for _ in pairs)


class TestWhatARunAsksFor:
    async def test_only_the_attributes_the_source_declares(self) -> None:
        """Asking a source for something it does not publish would come back as a failure per
        attribute and bury the failures that mean something."""
        adapter = StubAdapter({}, declares=(OVERBURDEN,))

        await acquire(
            adapter=adapter,
            attributes=[an_attribute(), an_attribute(PRESS_FREEDOM)],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
        )

        assert adapter.asked == [OVERBURDEN]

    async def test_a_run_over_nothing_it_can_answer_stores_nothing(self) -> None:
        adapter = StubAdapter({}, declares=(OVERBURDEN,))
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute(PRESS_FREEDOM)],
            candidates=[PORTUGAL],
            values=store,
        )

        assert store.appended == []
        assert outcome.stored == ()


class TestWhatARunKeeps:
    async def test_the_figures_that_came_back_are_appended(self) -> None:
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(a_value(),))}, declares=(OVERBURDEN,))
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=adapter, attributes=[an_attribute()], candidates=[PORTUGAL], values=store
        )

        assert len(store.appended) == 1
        assert outcome.stored == tuple(store.appended)

    async def test_a_value_streamed_before_a_mid_sweep_death_is_already_stored(self) -> None:
        """BE-19. A paid source asks per candidate and used to buffer every answer until the
        whole attribute returned, so a process dying part-way lost the paid answers already in
        hand. `acquire` now stores each batch as it is yielded, so a death after the first
        candidate keeps the first candidate's figure -- and its failure reaches the run's own
        list the same way."""
        first = a_value()
        store = RecordingValueStore()
        collected: list[AcquisitionFailure] = []

        class DiesAfterTheFirstCandidate(SourceAdapter):
            @property
            def data_source(self) -> DataSourceId:
                return DataSourceId("llm")

            @property
            def attributes(self) -> tuple:
                return (OVERBURDEN,)

            async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]):
                acquired = Acquired()
                async for batch in self.fetch_in_batches(attribute, candidates):
                    acquired += batch
                return acquired

            async def fetch_in_batches(
                self, attribute: Attribute, candidates: Sequence[Candidate]
            ) -> AsyncIterator[Acquired]:
                yield Acquired(values=(first,))
                raise RuntimeError("the process died mid-sweep")

        with pytest.raises(RuntimeError, match="died mid-sweep"):
            await acquire(
                adapter=DiesAfterTheFirstCandidate(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL],
                values=store,
                run=7,
                collecting=collected,
            )

        assert [value.candidate for value in store.appended] == [first.candidate]
        assert store.appended[0].data_acquisition_run == 7

    async def test_spend_billed_before_a_mid_sweep_death_is_already_recorded(self) -> None:
        """BE-33. A run's spend was written only when a source finished, so a death mid-sweep
        kept the figures already stored (BE-19) but lost the record of what they cost -- the
        provider billed it and the run understated it. Recorded per batch, the spend of what was
        billed before the death survives."""
        persisted: list[tuple[int, Decimal]] = []

        class DiesAfterBillingOneCall(SourceAdapter):
            @property
            def data_source(self) -> DataSourceId:
                return DataSourceId("llm")

            @property
            def attributes(self) -> tuple:
                return (OVERBURDEN,)

            async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]):
                acquired = Acquired()
                async for batch in self.fetch_in_batches(attribute, candidates):
                    acquired += batch
                return acquired

            async def fetch_in_batches(self, attribute: Attribute, candidates: Sequence[Candidate]):
                yield Acquired(cost_eur=Decimal("0.05"), calls=1)
                raise RuntimeError("the process died mid-sweep")

        async def record(calls: int, cost: Decimal) -> None:
            persisted.append((calls, cost))

        with pytest.raises(RuntimeError, match="died mid-sweep"):
            await acquire(
                adapter=DiesAfterBillingOneCall(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL],
                values=RecordingValueStore(),
                run=9,
                record_spend=record,
            )

        assert persisted == [(1, Decimal("0.05"))]

    async def test_failures_collected_before_a_mid_sweep_death_are_already_recorded(self) -> None:
        """BE-19 remainder. Failures were held only in the run's in-memory list and written at the
        halts and the end, so a *hard kill* -- which raises nothing Python can catch -- lost them:
        the swept run reported failing on nothing, and a retry found nothing to reach. Recorded per
        batch, the failures of what was asked before the death survive the kill."""
        persisted: list[AcquisitionFailure] = []

        class DiesAfterFailingOneCandidate(SourceAdapter):
            @property
            def data_source(self) -> DataSourceId:
                return DataSourceId("llm")

            @property
            def attributes(self) -> tuple:
                return (OVERBURDEN,)

            async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]):
                acquired = Acquired()
                async for batch in self.fetch_in_batches(attribute, candidates):
                    acquired += batch
                return acquired

            async def fetch_in_batches(self, attribute: Attribute, candidates: Sequence[Candidate]):
                yield Acquired(
                    failures=(
                        AcquisitionFailure(
                            attribute=OVERBURDEN, candidate="country.portugal", reason="timed out"
                        ),
                    )
                )
                raise RuntimeError("the process died mid-sweep")

        async def record(batch: Sequence[AcquisitionFailure]) -> None:
            persisted.extend(batch)

        with pytest.raises(RuntimeError, match="died mid-sweep"):
            await acquire(
                adapter=DiesAfterFailingOneCandidate(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL],
                values=RecordingValueStore(),
                run=11,
                record_failures=record,
            )

        assert [(f.attribute, f.candidate, f.data_source) for f in persisted] == [
            (OVERBURDEN, "country.portugal", DataSourceId("llm"))
        ]

    async def test_a_source_re_confirming_a_stored_pair_records_a_reuse_not_a_gap(self) -> None:
        """ST-09. The source answered, but the figure was already on record so the append is a
        no-op -- a transcribed table re-read as the same observation. The run records the pair as
        re-confirmed, so its accounting counts it completed rather than offering to ask again for
        a figure that is already there."""
        value = a_value()
        pair = (str(value.candidate), str(value.attribute))
        store = RecordingValueStore(already_holds=(value,))
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(value,))}, declares=(OVERBURDEN,))

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.appended == []
        assert store.reused == [pair]
        assert outcome.stored == ()

    async def test_a_reuse_is_recorded_under_the_source_that_re_read_it(self) -> None:
        """NEW-54. Two sources can re-read the same pair, and the breakdown credits each source
        with what it answered -- so a reuse is recorded against the source, as a failure is."""
        value = a_value()
        store = RecordingValueStore(already_holds=(value,))
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(value,))}, declares=(OVERBURDEN,))

        await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.reused_by == [str(adapter.data_source)]

    async def test_a_re_confirmation_names_the_figure_on_record(self) -> None:
        """PL-049. The diff reads the figure a run restated, so the reuse names the stored row:
        the row on record, not the copy the source handed back, which has no id."""
        fetched = a_value()
        store = RecordingValueStore(already_holds=(fetched.model_copy(update={"id": 41}),))
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(fetched,))}, declares=(OVERBURDEN,))

        await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.restated == {("country.portugal", OVERBURDEN): 41}

    async def test_a_pair_re_confirmed_through_two_figures_names_neither(self) -> None:
        """One reuse row per pair cannot name two rows, and naming one of them would call the
        other unchanged without evidence -- so none, which the diff reads as refreshed."""
        figures = [
            a_value().model_copy(update={"breakdown_option": option}) for option in ("a", "b")
        ]
        store = RecordingValueStore(
            already_holds=[
                figure.model_copy(update={"id": stored_id})
                for figure, stored_id in zip(figures, (41, 42), strict=True)
            ]
        )
        adapter = StubAdapter({OVERBURDEN: Acquired(values=tuple(figures))}, declares=(OVERBURDEN,))

        await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.restated == {("country.portugal", OVERBURDEN): None}

    async def test_a_freshly_stored_pair_is_not_recorded_as_a_reuse(self) -> None:
        """The other side: a pair stored for the first time is not re-confirmation, so nothing
        goes to the reuse record -- only a no-op append is."""
        store = RecordingValueStore()
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(a_value(),))}, declares=(OVERBURDEN,))

        await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.reused == []

    async def test_a_run_completes_and_reports_what_failed(self) -> None:
        """`reqs.md` 6.4. A run that aborted on the first problem would be a run that never
        finished, because a sparse indicator fails routinely."""
        adapter = StubAdapter(
            {
                OVERBURDEN: Acquired(values=(a_value(),)),
                PRESS_FREEDOM: Acquired(
                    failures=(AcquisitionFailure(attribute=PRESS_FREEDOM, reason="503"),)
                ),
            },
            declares=(OVERBURDEN, PRESS_FREEDOM),
        )

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute(), an_attribute(PRESS_FREEDOM)],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
        )

        assert len(outcome.stored) == 1
        assert len(outcome.failures) == 1
        assert outcome.attempted == 2

    async def test_every_failure_is_stamped_with_the_source_that_failed(self) -> None:
        """Two sources answer the total tax rate, and a retry has to know which to ask again.
        Stamped here rather than trusted to each adapter, as a value's run is."""
        adapter = StubAdapter(
            {PRESS_FREEDOM: Acquired(failures=(AcquisitionFailure(PRESS_FREEDOM, "503"),))},
            declares=(PRESS_FREEDOM,),
        )

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute(PRESS_FREEDOM)],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
        )

        assert [failure.data_source for failure in outcome.failures] == ["eurostat"]

    async def test_a_run_that_found_nothing_appends_nothing_at_all(self) -> None:
        """Not an empty write. A store call with no rows is a transaction for nothing."""
        adapter = StubAdapter({OVERBURDEN: Acquired()}, declares=(OVERBURDEN,))
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=adapter, attributes=[an_attribute()], candidates=[PORTUGAL], values=store
        )

        assert store.appended == []
        assert outcome.failures == ()

    async def test_a_rejected_figure_is_kept_and_recorded_as_a_failure(self) -> None:
        """BE-08, `reqs.md` 3.3a. A figure outside its credible range is stored with the reason
        beside it and never becomes active -- and nothing made it a failure, so a retry of the
        run answered "failed on nothing" about the one item it should have gone back to."""
        rejected = a_rejected_value()
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(rejected,))}, declares=(OVERBURDEN,))
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=adapter, attributes=[an_attribute()], candidates=[PORTUGAL], values=store
        )

        assert store.appended == [rejected]
        (failure,) = outcome.failures
        assert (failure.attribute, failure.candidate, failure.data_source) == (
            OVERBURDEN,
            "country.portugal",
            "eurostat",
        )
        assert NOT_CREDIBLE in failure.reason

    async def test_an_accepted_figure_records_no_failure(self) -> None:
        """The control: only a figure carrying a verdict against it is a failure."""
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(a_value(),))}, declares=(OVERBURDEN,))

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
        )

        assert outcome.failures == ()

    async def test_a_rejected_figure_reaches_the_runs_own_list_as_it_happens(self) -> None:
        """P66: what is known survives an exception from the next fetch, so a rejection is
        handed over with the source's own failures rather than only on the way out."""
        adapter = StubAdapter(
            {OVERBURDEN: Acquired(values=(a_rejected_value(),))}, declares=(OVERBURDEN,)
        )
        collecting: list[AcquisitionFailure] = []

        await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
            collecting=collecting,
        )

        assert [failure.reason for failure in collecting] == [
            f"the figure was stored and rejected: {NOT_CREDIBLE}"
        ]


class ProcessKilled(BaseException):
    """kill -9, as near as a unit test gets. `continue_run` catches `Exception` and records what
    it can on the way out; it cannot catch this, so nothing after the kill is written -- which is
    the whole difference between a kill and an error."""


class FailureWriter:
    """The run's per-batch failure writer, keeping what it was handed -- what a kill finds."""

    def __init__(self) -> None:
        self.committed: list[AcquisitionFailure] = []

    async def __call__(self, batch: Sequence[AcquisitionFailure]) -> None:
        self.committed.extend(batch)


class DiesWritingARejectedFigure(RecordingValueStore):
    async def append(self, values):
        if any(value.is_rejected for value in values):
            raise ProcessKilled
        return await super().append(values)


class DiesReConfirmingAPair(RecordingValueStore):
    async def record_reuse(self, run, data_source, pairs) -> None:
        pairs = list(pairs)
        if pairs:
            raise ProcessKilled
        await super().record_reuse(run, data_source, pairs)


class AlreadyHoldsOptions(RecordingValueStore):
    """Holds some breakdown options of a pair already, so appending those is a no-op."""

    def __init__(self, *held: str) -> None:
        super().__init__()
        self._held = set(held)

    async def append(self, values):
        newly = [value for value in values if value.breakdown_option not in self._held]
        self.appended.extend(newly)
        return tuple(newly)

    async def read_observations(self, values):
        return tuple(value for value in values if value.breakdown_option in self._held)


class TestTheOrderABatchIsWrittenIn:
    """P93. A rejected figure is a failure as well (BE-08), and the failure -- the only row a retry
    reads -- used to commit after the figure and its reuse row. A kill between them kept the
    rejection and lost the failure, so the pair was never asked again. Each batch is now written
    accepted figures first, then its failures, then its rejected figures."""

    async def test_a_rejection_s_failure_is_committed_before_its_figure(self) -> None:
        written = FailureWriter()

        with pytest.raises(ProcessKilled):
            await acquire(
                adapter=StubAdapter(
                    {OVERBURDEN: Acquired(values=(a_rejected_value(),))}, declares=(OVERBURDEN,)
                ),
                attributes=[an_attribute()],
                candidates=[PORTUGAL],
                values=DiesWritingARejectedFigure(),
                run=13,
                record_failures=written,
            )

        assert [failure.reason for failure in written.committed] == [
            f"the figure was stored and rejected: {NOT_CREDIBLE}"
        ]

    async def test_a_re_read_rejection_s_failure_is_committed_before_its_reuse_row(self) -> None:
        """A transcribed figure already on record is a no-op append and a reuse row. Left without
        its failure, that row is credited as stored by its source's breakdown."""
        rejected = a_rejected_value()
        pair = (str(rejected.candidate), str(rejected.attribute))
        written = FailureWriter()

        with pytest.raises(ProcessKilled):
            await acquire(
                adapter=StubAdapter(
                    {OVERBURDEN: Acquired(values=(rejected,))}, declares=(OVERBURDEN,)
                ),
                attributes=[an_attribute()],
                candidates=[PORTUGAL],
                values=DiesReConfirmingAPair(already_holds=(rejected,)),
                run=13,
                record_failures=written,
            )

        assert [(failure.candidate, failure.attribute) for failure in written.committed] == [pair]

    async def test_a_failure_that_cannot_be_written_keeps_the_figures_already_accepted(
        self,
    ) -> None:
        """The half that writing every failure first would lose (BE-19). A failure write that
        raises -- a database fault -- must not cost a paid batch the figures it already bought,
        nor store a rejected figure without its failure."""
        accepted = a_value().model_copy(update={"candidate": "country.spain"})
        store = RecordingValueStore()

        async def refuse(batch: Sequence[AcquisitionFailure]) -> None:
            raise RuntimeError("the database refused the write")

        with pytest.raises(RuntimeError, match="refused the write"):
            await acquire(
                adapter=StubAdapter(
                    {OVERBURDEN: Acquired(values=(accepted, a_rejected_value()))},
                    declares=(OVERBURDEN,),
                ),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=store,
                run=13,
                record_failures=refuse,
            )

        assert [(value.candidate, value.is_rejected) for value in store.appended] == [
            ("country.spain", False)
        ]

    @pytest.mark.parametrize(
        ("already_held", "re_confirmed"),
        [
            ((), False),
            (("rejected",), False),
            (("accepted",), False),
            (("accepted", "rejected"), True),
        ],
        ids=["both new", "only the accepted new", "only the rejected new", "neither new"],
    )
    async def test_a_pair_is_re_confirmed_only_when_none_of_its_figures_is_new(
        self, already_held: tuple[str, ...], re_confirmed: bool
    ) -> None:
        """ST-09's rule survives the split. A pair answered by an accepted and a rejected breakdown
        option is re-confirmed only when neither figure was new, and recorded once."""
        accepted = a_value().model_copy(update={"breakdown_option": "accepted"})
        rejected = a_rejected_value().model_copy(update={"breakdown_option": "rejected"})
        store = AlreadyHoldsOptions(*already_held)

        await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(accepted, rejected))}, declares=(OVERBURDEN,)
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=13,
        )

        assert store.reused == ([("country.portugal", OVERBURDEN)] if re_confirmed else [])


class TestWhenTheCapIsReachedInsideOneSource:
    """The cap has to bite between *attributes*, not only between sources (P47).

    One source answering three uncovered attributes over 32 countries is one `acquire` call and
    close to a hundred paid ones. The meter used to be read only after the whole call returned,
    so a cap of 1 EUR let nearly 5 EUR go out and then reported the run halted -- a receipt, not
    a ceiling.
    """

    @staticmethod
    def three_paid_attributes() -> StubAdapter:
        """Each attribute costs half the cap, so the third must never be asked."""
        half = Acquired(values=(), cost_eur=Decimal("0.50"), calls=1)
        return StubAdapter(
            {OVERBURDEN: half, PRESS_FREEDOM: half, ENGLISH: half},
            declares=(OVERBURDEN, PRESS_FREEDOM, ENGLISH),
        )

    async def asking(self, adapter: StubAdapter, meter: CostMeter) -> object:
        return await acquire(
            adapter=adapter,
            attributes=[
                an_attribute(OVERBURDEN),
                an_attribute(PRESS_FREEDOM),
                an_attribute(ENGLISH),
            ],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
            meter=meter,
        )

    async def test_it_stops_asking_once_the_cap_is_reached(self) -> None:
        adapter = self.three_paid_attributes()

        await self.asking(adapter, CostMeter(cap_eur=Decimal(1)))

        assert adapter.asked == [OVERBURDEN, PRESS_FREEDOM], "the third would have crossed it"

    async def test_what_it_spent_is_recorded_as_it_goes(self) -> None:
        """The meter is the run's own account, so a halt one level up reads the same number."""
        meter = CostMeter(cap_eur=Decimal(1))

        outcome = await self.asking(self.three_paid_attributes(), meter)

        assert meter.spent_eur == Decimal(1)
        assert meter.calls == 2
        assert outcome.cost_eur == Decimal(1)  # type: ignore[attr-defined]

    async def test_an_uncapped_run_asks_everything(self) -> None:
        """The control. An accepted uncapped run is never exhausted, and nothing may stop it."""
        adapter = self.three_paid_attributes()

        await self.asking(adapter, CostMeter(cap_eur=None))

        assert adapter.asked == [OVERBURDEN, PRESS_FREEDOM, ENGLISH]

    async def test_a_run_under_its_cap_asks_everything(self) -> None:
        """The other control: the cap must stop a sweep, not shorten every one."""
        adapter = self.three_paid_attributes()

        await self.asking(adapter, CostMeter(cap_eur=Decimal(100)))

        assert adapter.asked == [OVERBURDEN, PRESS_FREEDOM, ENGLISH]

    async def test_a_free_source_needs_no_meter_at_all(self) -> None:
        """Every source shipped today is free and passes none, which must keep working."""
        adapter = StubAdapter({OVERBURDEN: Acquired(values=(a_value(),))}, declares=(OVERBURDEN,))

        outcome = await acquire(
            adapter=adapter,
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
        )

        assert len(outcome.stored) == 1


class TestAZeroCapDoesNotHaltAFreeSweep:
    """A cap of zero means "spend nothing", not "fetch nothing" (BE-16). A free sweep spends
    nothing, so it must answer every attribute -- only `is_exhausted` being true at zero spend
    (0 >= 0) used to break it after the first."""

    async def test_a_free_source_answers_every_attribute_under_a_zero_cap(self) -> None:
        adapter = StubAdapter(
            {
                OVERBURDEN: Acquired(values=(a_value(),)),
                PRESS_FREEDOM: Acquired(),
                ENGLISH: Acquired(),
            },
            declares=(OVERBURDEN, PRESS_FREEDOM, ENGLISH),
        )

        await acquire(
            adapter=adapter,
            attributes=[
                an_attribute(OVERBURDEN),
                an_attribute(PRESS_FREEDOM),
                an_attribute(ENGLISH),
            ],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
            meter=CostMeter(cap_eur=Decimal(0)),
        )

        assert adapter.asked == [OVERBURDEN, PRESS_FREEDOM, ENGLISH]


class ASourceThatBillsPerCandidate(SourceAdapter):
    """One billed call per candidate, which is the shape of both LLM adapters.

    It honours `stop_when`, as a paid source must: the run reads its meter between
    *attributes*, and for this shape one attribute is one call per candidate.
    """

    def __init__(self, *, eur_per_candidate: str) -> None:
        self._price = Decimal(eur_per_candidate)
        self.asked_about: list[str] = []
        self._meter: RunningSpend | None = None

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("llm")

    @property
    def attributes(self) -> tuple:
        return (OVERBURDEN,)

    @property
    def costs_money(self) -> bool:
        return True

    def meter_with(self, meter: RunningSpend) -> None:
        self._meter = meter

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        cost, calls = Decimal(0), 0
        for candidate in candidates:
            if self._meter is not None and self._meter.is_exhausted:
                continue
            self.asked_about.append(str(candidate.id))
            cost += self._price
            calls += 1
            # Recorded as it is billed, which is what makes the check above see anything.
            if self._meter is not None:
                self._meter.spent(cost_eur=self._price, calls=1)
        return Acquired(values=(), cost_eur=cost, calls=calls)


class ASourceThatIgnoresTheCap(ASourceThatBillsPerCandidate):
    """A paid source that never asks. The cap still has to hold to within one attribute."""

    def meter_with(self, meter: RunningSpend) -> None:
        return


class TestTheCapInsideOneCandidateSweep:
    """The residue P47 left behind (P91).

    P47 moved the check from between sources to between attributes, and one `fetch` is one
    attribute over *every* candidate. For a source billing per candidate that is 32 calls, all
    of them committed before anything looks at the meter -- so a 1.00 EUR cap could bill about
    1.60 on the first attribute alone.
    """

    async def asking(self, adapter: SourceAdapter, meter: CostMeter) -> object:
        return await acquire(
            adapter=adapter,
            attributes=[an_attribute(OVERBURDEN)],
            candidates=[PORTUGAL, SPAIN, GREECE],
            values=RecordingValueStore(),
            meter=meter,
        )

    async def test_it_stops_partway_through_the_candidates(self) -> None:
        # Each candidate costs the whole cap, so only the first may be asked about.
        adapter = ASourceThatBillsPerCandidate(eur_per_candidate="1.00")

        await self.asking(adapter, CostMeter(cap_eur=Decimal(1)))

        assert adapter.asked_about == [str(PORTUGAL.id)]

    async def test_what_was_paid_for_is_still_counted(self) -> None:
        """The cap is a stop, not a refund: the call that reached it was billed."""
        adapter = ASourceThatBillsPerCandidate(eur_per_candidate="1.00")
        meter = CostMeter(cap_eur=Decimal(1))

        await self.asking(adapter, meter)

        assert meter.spent_eur == Decimal("1.00")
        assert meter.is_exhausted

    async def test_an_uncapped_run_asks_about_every_candidate(self) -> None:
        """The other half, so the stop cannot be "never ask about more than one"."""
        adapter = ASourceThatBillsPerCandidate(eur_per_candidate="1.00")

        await self.asking(adapter, CostMeter(cap_eur=None))

        assert len(adapter.asked_about) == 3

    async def test_a_free_source_is_never_told_to_stop(self) -> None:
        """`stop_when` is called only for a source that says it charges, so the eight free
        adapters are never handed a hook they cannot use."""
        told: list[bool] = []

        class AFreeSource(StubAdapter):
            def meter_with(self, meter: RunningSpend) -> None:
                told.append(True)

        adapter = AFreeSource({OVERBURDEN: Acquired()}, declares=(OVERBURDEN,))
        await acquire(
            adapter=adapter,
            attributes=[an_attribute(OVERBURDEN)],
            candidates=[PORTUGAL],
            values=RecordingValueStore(),
            meter=CostMeter(cap_eur=Decimal(1)),
        )

        assert told == []

    async def test_a_paid_source_that_ignores_the_hook_is_still_bounded(self) -> None:
        """**The guarantee does not rest on an adapter's good behaviour.** One that never asks
        overruns by at most its own attribute, because the check between attributes remains."""
        adapter = ASourceThatIgnoresTheCap(eur_per_candidate="1.00")
        meter = CostMeter(cap_eur=Decimal(1))

        await self.asking(adapter, meter)

        assert len(adapter.asked_about) == 3
        assert meter.is_exhausted


class SecretBearingCrashError(RuntimeError):
    """An unforeseen fault whose message must never reach a stored failure (P1-11)."""


class AnswersPortugalThenCrashes(SourceAdapter):
    """Yields one batch answering Portugal, then raises something nobody turned into a failure."""

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("eurostat")

    @property
    def attributes(self) -> tuple:
        return (OVERBURDEN,)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        raise NotImplementedError

    async def fetch_in_batches(
        self, attribute: Attribute, candidates: Sequence[Candidate]
    ) -> AsyncIterator[Acquired]:
        yield Acquired(values=(a_value(),))
        raise SecretBearingCrashError("token=abc123 in the parser's state")


class FailsToAppend(RecordingValueStore):
    async def append(self, values):
        raise ConnectionError("the database went away")


class TestASourceThatCrashesMidAttribute:
    """PL-047 (RN-R2). An exception a source never turned into a failure left the run with no
    row for the candidates it had not yet answered, so they read as "every source answered,
    none had a row" -- unanswered, and retrying them was said to change nothing."""

    async def test_a_source_that_raises_mid_attribute_leaves_a_failure_for_each_unanswered_candidate(  # noqa: E501
        self,
    ) -> None:
        persisted: list[AcquisitionFailure] = []
        collected: list[AcquisitionFailure] = []

        async def record(batch: Sequence[AcquisitionFailure]) -> None:
            persisted.extend(batch)

        with pytest.raises(SecretBearingCrashError):
            await acquire(
                adapter=AnswersPortugalThenCrashes(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=RecordingValueStore(),
                run=13,
                collecting=collected,
                record_failures=record,
            )

        assert [(f.attribute, f.candidate, f.data_source) for f in persisted] == [
            (OVERBURDEN, str(SPAIN.id), DataSourceId("eurostat"))
        ]
        assert collected == persisted
        assert "SecretBearingCrashError" in persisted[0].reason
        assert "abc123" not in persisted[0].reason

    async def test_a_store_fault_is_not_recorded_as_the_sources_failure(self) -> None:
        persisted: list[AcquisitionFailure] = []
        collected: list[AcquisitionFailure] = []

        async def record(batch: Sequence[AcquisitionFailure]) -> None:
            persisted.extend(batch)

        with pytest.raises(ConnectionError):
            await acquire(
                adapter=AnswersPortugalThenCrashes(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=FailsToAppend(),
                run=14,
                collecting=collected,
                record_failures=record,
            )

        assert persisted == []
        assert collected == []

    async def test_a_fault_recording_the_crash_does_not_mask_the_crash(self) -> None:
        """The original exception is the one that propagates; the run records `collecting`
        again on its way out, so the failures are still in hand."""
        collected: list[AcquisitionFailure] = []

        async def cannot_record(batch: Sequence[AcquisitionFailure]) -> None:
            raise ConnectionError("the database went away")

        with pytest.raises(SecretBearingCrashError):
            await acquire(
                adapter=AnswersPortugalThenCrashes(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=RecordingValueStore(),
                run=15,
                collecting=collected,
                record_failures=cannot_record,
            )

        assert [f.candidate for f in collected] == [str(SPAIN.id)]


class TestHowFarASourceGot:
    """C04-N6. An attribute is marked finished for its source only once the source got through
    it, so an item it never reached reads "not reached" and never "nobody had a row"."""

    @staticmethod
    async def marking(adapter: SourceAdapter, **asked: object) -> list[str]:
        marked: list[str] = []

        async def mark(attribute: str) -> None:
            marked.append(str(attribute))

        await acquire(
            adapter=adapter,
            candidates=[PORTUGAL, SPAIN],
            values=RecordingValueStore(),
            mark_finished=mark,
            **asked,  # type: ignore[arg-type]
        )
        return marked

    async def test_an_attribute_is_marked_finished_only_after_its_last_batch(self) -> None:
        """Mutation: marking before the batches are read marks the attribute the crash below
        cut short."""
        marked: list[str] = []

        async def mark(attribute: str) -> None:
            marked.append(str(attribute))

        with pytest.raises(SecretBearingCrashError):
            await acquire(
                adapter=AnswersPortugalThenCrashes(),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=RecordingValueStore(),
                mark_finished=mark,
            )

        assert marked == []

    async def test_every_attribute_a_source_got_through_is_marked(self) -> None:
        adapter = StubAdapter(
            {OVERBURDEN: Acquired(values=(a_value(),))}, declares=(OVERBURDEN, PRESS_FREEDOM)
        )

        marked = await self.marking(
            adapter, attributes=[an_attribute(OVERBURDEN), an_attribute(PRESS_FREEDOM)]
        )

        assert marked == [OVERBURDEN, PRESS_FREEDOM]

    async def test_an_attribute_the_meter_cut_short_is_not_finished(self) -> None:
        """The second attribute reaches the 1 EUR cap: a source billing per candidate stops
        asking there, so it may have left candidates nobody asked about."""
        half = Acquired(values=(), cost_eur=Decimal("0.50"), calls=1)
        adapter = StubAdapter(
            {OVERBURDEN: half, PRESS_FREEDOM: half, ENGLISH: half},
            declares=(OVERBURDEN, PRESS_FREEDOM, ENGLISH),
        )

        marked = await self.marking(
            adapter,
            attributes=[
                an_attribute(OVERBURDEN),
                an_attribute(PRESS_FREEDOM),
                an_attribute(ENGLISH),
            ],
            meter=CostMeter(cap_eur=Decimal(1)),
        )

        assert marked == [OVERBURDEN]

    async def test_a_zero_cap_does_not_leave_a_free_sweep_unfinished(self) -> None:
        """BE-16's case: nothing was spent, so the cap stopped nothing."""
        adapter = StubAdapter({}, declares=(OVERBURDEN,))

        marked = await self.marking(
            adapter, attributes=[an_attribute(OVERBURDEN)], meter=CostMeter(cap_eur=Decimal(0))
        )

        assert marked == [OVERBURDEN]


CONTRADICTION = "a different figure is already on record for this observation"


def a_corrected_value(stored: Value) -> Value:
    """The same observation -- one natural key -- read again with another figure, as a
    transcribed table edited without a new `transcribed_on` produces it (NEW-23)."""
    return stored.model_copy(update={"payload": Ratio(value=Decimal("7.1"), basis="households")})


class TestAReReadThatContradictsTheStoredFigure:
    """NEW-23, decision P1-10. A re-read under the same natural key either restates the stored
    figure and verdict -- a re-confirmation -- or is reported as a failure naming the conflict.
    It is never silently kept as re-confirmed."""

    async def test_a_re_read_that_contradicts_the_stored_figure_is_a_failure_not_a_reuse(
        self,
    ) -> None:
        stored = a_value()
        store = RecordingValueStore(already_holds=(stored,))
        persisted: list[AcquisitionFailure] = []

        async def record(batch: Sequence[AcquisitionFailure]) -> None:
            persisted.extend(batch)

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(a_corrected_value(stored),))},
                declares=(OVERBURDEN,),
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
            record_failures=record,
        )

        assert store.reused == []
        assert store.appended == []
        (failure,) = persisted
        assert (failure.candidate, failure.attribute, failure.data_source) == (
            "country.portugal",
            OVERBURDEN,
            DataSourceId("eurostat"),
        )
        assert CONTRADICTION in failure.reason
        assert "transcribed_on" in failure.reason
        assert outcome.failures == (failure,)

    async def test_a_re_read_that_restates_the_stored_figure_is_a_reuse(self) -> None:
        """The control. Only its words differ (NEW-33), so it is the same observation."""
        stored = a_value()
        re_quoted = stored.model_copy(update={"quote": "the same figure, worded again"})
        store = RecordingValueStore(already_holds=(stored,))

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(re_quoted,))}, declares=(OVERBURDEN,)
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert store.reused == [("country.portugal", OVERBURDEN)]
        assert outcome.failures == ()

    async def test_make_acquire_reports_the_conflict_without_a_run(self) -> None:
        """`make acquire` passes no run, and prints `outcome.failures`: the conflict must be
        among them, or the command reports a clean pass over a figure it did not store."""
        stored = a_value()

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(a_corrected_value(stored),))},
                declares=(OVERBURDEN,),
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=RecordingValueStore(already_holds=(stored,)),
        )

        assert [CONTRADICTION in failure.reason for failure in outcome.failures] == [True]

    async def test_a_re_read_rejected_where_the_stored_figure_was_accepted_is_a_conflict(
        self,
    ) -> None:
        """The verdict counts as well: a narrowed credible range turns the same reading into a
        different one. Reported as the conflict, not as a figure "stored and rejected" -- nothing
        was stored."""
        stored = a_value()
        rejected_now = stored.model_copy(update={"rejection_reason": NOT_CREDIBLE})
        store = RecordingValueStore(already_holds=(stored,))

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(rejected_now,))}, declares=(OVERBURDEN,)
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert [CONTRADICTION in failure.reason for failure in outcome.failures] == [True]
        assert store.reused == []

    async def test_the_conflict_is_committed_with_the_batch_s_failures_before_its_rejections(
        self,
    ) -> None:
        """P93's order: accepted figures, then the batch's failures, then its rejected figures. A
        kill writing the rejected figure keeps the conflict it was reported with."""
        stored = a_value().model_copy(update={"candidate": "country.spain"})
        written = FailureWriter()

        with pytest.raises(ProcessKilled):
            await acquire(
                adapter=StubAdapter(
                    {OVERBURDEN: Acquired(values=(a_corrected_value(stored), a_rejected_value()))},
                    declares=(OVERBURDEN,),
                ),
                attributes=[an_attribute()],
                candidates=[PORTUGAL, SPAIN],
                values=DiesWritingARejectedFigure(already_holds=(stored,)),
                run=13,
                record_failures=written,
            )

        assert sorted(failure.candidate for failure in written.committed) == [
            "country.portugal",
            "country.spain",
        ]
        assert any(CONTRADICTION in failure.reason for failure in written.committed)

    async def test_two_figures_under_one_new_key_in_one_batch_are_a_conflict(self) -> None:
        """The batch's own figures are on record too, once the first is appended: the read
        before the append cannot see them, so a second, different figure under a key nothing
        held was dropped as a no-op and the run reported no failure at all."""
        first = a_value()
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(first, a_corrected_value(first)))},
                declares=(OVERBURDEN,),
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert [value.payload for value in store.appended] == [first.payload]
        assert [CONTRADICTION in failure.reason for failure in outcome.failures] == [True]
        assert store.reused == []

    async def test_the_same_figure_twice_in_one_batch_is_stored_once_and_no_conflict(
        self,
    ) -> None:
        """The control: a figure restated within its own batch is the same observation."""
        first = a_value()
        store = RecordingValueStore()

        outcome = await acquire(
            adapter=StubAdapter(
                {OVERBURDEN: Acquired(values=(first, first.model_copy(update={"quote": "again"})))},
                declares=(OVERBURDEN,),
            ),
            attributes=[an_attribute()],
            candidates=[PORTUGAL],
            values=store,
            run=5,
        )

        assert [value.payload for value in store.appended] == [first.payload]
        assert outcome.failures == ()
