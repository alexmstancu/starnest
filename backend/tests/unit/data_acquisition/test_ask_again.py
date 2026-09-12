"""Asking again about what nobody answered (`reqs.md` Q217).

The difference from a retry is the whole point and is what these tests hold in place: a retry
asks **the source that failed**, and this asks **every source that can answer**, because no
source failed -- each one asked answered, with nothing for that candidate.

The adapters are stubs, as they are for `acquire`: what is under test is which questions the
second run poses, not how any publisher answers one.
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
    Value,
    ValueType,
)
from starnest.data_acquisition import (
    Acquired,
    NothingToAskAgainError,
    Run,
    RunScope,
    RunStatus,
    RunStore,
    SourceAdapter,
    UnansweredItem,
    ask_again,
)

COUNTRY = {"id": "country", "depth_order": 1}
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"

LIECHTENSTEIN = Candidate(
    id="country.liechtenstein", name="Liechtenstein", level=COUNTRY, country_code="LI"
)
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")


def an_attribute(identifier: str) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


def a_value(candidate: str, attribute: str, source: str = "eurostat") -> Value:
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source=source,
        reference_period=ReferencePeriod(
            start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
        ),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("6.3"), basis="households"),
    )


class StubSource(SourceAdapter):
    """A source that answers for whatever it was told it covers, and records what it was asked."""

    def __init__(self, source: str, declares: tuple[str, ...], covers: tuple[str, ...]) -> None:
        self._source = source
        self._declares = declares
        self._covers = covers
        self.asked: list[tuple[str, tuple[str, ...]]] = []

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._source)

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        self.asked.append((str(attribute.id), tuple(str(c.id) for c in candidates)))
        return Acquired(
            values=tuple(
                a_value(str(candidate.id), str(attribute.id), self._source)
                for candidate in candidates
                if str(candidate.id) in self._covers
            )
        )


class RecordingValueStore:
    def __init__(self) -> None:
        self.appended: list[Value] = []

    async def append(self, values):
        self.appended.extend(values)
        return tuple(values)


class RecordingRunStore(RunStore):
    """A store that remembers what was opened and closed, and answers reads from one Run."""

    def __init__(self, answers_with: Run) -> None:
        self._answers_with = answers_with
        self.opened: list[RunScope] = []
        self.finished: list[int] = []

    async def start_run(self, scope: RunScope, *, triggered_by: str) -> int:
        self.opened.append(scope)
        return 900 + len(self.opened)

    async def finish_run(self, run: int, *, status: RunStatus, finished_at: datetime) -> None:
        self.finished.append(run)

    async def record_failures(self, run, failures) -> None:
        return None

    async def read_run(self, run: int) -> Run:
        return self._answers_with

    async def read_runs(self, *, limit: int = 20, offset: int = 0) -> tuple[Run, ...]:
        return ()

    async def count_runs(self) -> int:
        return 0


THE_SCOPE = RunScope(
    level="country",
    candidates=("country.liechtenstein", "country.portugal"),
    attributes=(OVERBURDEN, OVERCROWDING),
)


def a_run(
    unanswered: tuple[UnansweredItem, ...],
    scope: RunScope | None = THE_SCOPE,
) -> Run:
    return Run(
        id=41,
        status=RunStatus.COMPLETED,
        started_at=datetime.now(UTC),
        triggered_by="user",
        scope=scope,
        unanswered=unanswered,
    )


async def asking_again(
    run: Run, adapters: tuple[StubSource, ...]
) -> tuple[RecordingRunStore, RecordingValueStore]:
    runs = RecordingRunStore(answers_with=run)
    values = RecordingValueStore()
    await ask_again(
        run=run,
        adapters=list(adapters),
        attributes=[an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)],
        candidates=[LIECHTENSTEIN, PORTUGAL],
        values=values,
        runs=runs,
    )
    return runs, values


class TestWhatItRefuses:
    async def test_a_run_where_everything_was_answered_or_failed(self) -> None:
        """A new run over an empty scope would be a no-op recorded as though it were work."""
        with pytest.raises(NothingToAskAgainError, match="nothing to ask again"):
            await asking_again(a_run(unanswered=()), (a_source(),))

    async def test_a_run_whose_scope_was_never_written(self) -> None:
        """Without a scope there is no level to run at, and inventing one would run against
        candidates nobody asked about."""
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)
        with pytest.raises(NothingToAskAgainError):
            await asking_again(a_run(unanswered=unanswered, scope=None), (a_source(),))

    async def test_nothing_is_opened_when_it_refuses(self) -> None:
        runs = RecordingRunStore(answers_with=a_run(unanswered=()))
        with pytest.raises(NothingToAskAgainError):
            await ask_again(
                run=a_run(unanswered=()),
                adapters=[a_source()],
                attributes=[an_attribute(OVERBURDEN)],
                candidates=[LIECHTENSTEIN],
                values=RecordingValueStore(),
                runs=runs,
            )

        assert runs.opened == []


def a_source(
    source: str = "eurostat",
    declares: tuple[str, ...] = (OVERBURDEN, OVERCROWDING),
    covers: tuple[str, ...] = (),
) -> StubSource:
    return StubSource(source=source, declares=declares, covers=covers)


class TestWhatItAsks:
    async def test_only_the_items_nobody_answered(self) -> None:
        """Portugal answered and overcrowding answered; neither is asked about again."""
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)

        runs, _ = await asking_again(a_run(unanswered), (a_source(),))

        assert runs.opened[0].candidates == ("country.liechtenstein",)
        assert runs.opened[0].attributes == (OVERBURDEN,)

    async def test_every_source_that_can_answer_the_attribute_is_asked(self) -> None:
        """**The difference from a retry.** No source failed, so there is none to narrow to: the
        previous run's silence says only that none of the sources asked had a row."""
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)
        eurostat = a_source()
        world_bank = a_source(source="world_bank", declares=(OVERBURDEN,))

        await asking_again(a_run(unanswered), (eurostat, world_bank))

        assert eurostat.asked == [(OVERBURDEN, ("country.liechtenstein",))]
        assert world_bank.asked == [(OVERBURDEN, ("country.liechtenstein",))]

    async def test_a_source_that_cannot_answer_it_is_not_asked(self) -> None:
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)
        unrelated = a_source(source="world_bank", declares=(OVERCROWDING,))

        await asking_again(a_run(unanswered), (a_source(), unrelated))

        assert unrelated.asked == []

    async def test_the_level_is_the_earlier_run_s(self) -> None:
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)

        runs, _ = await asking_again(a_run(unanswered), (a_source(),))

        assert runs.opened[0].level == "country"


class TestWhatItKeeps:
    async def test_a_figure_that_arrives_this_time_is_stored(self) -> None:
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)
        answering = a_source(covers=("country.liechtenstein",))

        _, values = await asking_again(a_run(unanswered), (answering,))

        assert [(v.candidate, v.attribute) for v in values.appended] == [
            ("country.liechtenstein", OVERBURDEN)
        ]

    async def test_the_new_run_is_the_one_closed_not_the_old_one(self) -> None:
        """The run asked about keeps its own record either way (`reqs.md` 6.4)."""
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)

        runs, _ = await asking_again(a_run(unanswered), (a_source(),))

        assert runs.finished == [901]

    async def test_a_second_silence_leaves_nothing_stored(self) -> None:
        """The honest outcome for a country a dataset does not cover: asked again, still nothing,
        and no figure invented to fill the gap."""
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)

        _, values = await asking_again(a_run(unanswered), (a_source(),))

        assert values.appended == []
