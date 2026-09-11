"""One acquisition run, over a source that is not the network.

The adapter under a run is a stub here on purpose: what is under test is what a *run* does with
whatever an adapter returns -- which attributes it asks about, what it stores, and what it does
when a fetch fails. Eurostat's own behaviour is tested where Eurostat lives.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal

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
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter, acquire

COUNTRY = {"id": "country", "depth_order": 1}
OVERBURDEN = "country.housing_cost_overburden_rate"
PRESS_FREEDOM = "country.press_freedom"


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
    """Just enough `ValueStore` to see what a run tried to append."""

    def __init__(self) -> None:
        self.appended: list[Value] = []

    async def append(self, values):
        self.appended.extend(values)
        return tuple(values)


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
