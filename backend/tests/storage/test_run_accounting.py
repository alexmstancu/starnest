"""How a run accounts for its items, from the rows a real pass leaves (PL-050, PL-055, PL-056).

An item with neither a figure nor a failure is **unanswered** only once every source planned to
answer its attribute has been asked about it; until then it is **not reached** (C04-N6). Each
scenario here is a pass through `execute_run` against the real store -- completed, stopped,
killed, still going, retried, and one opened the way runs were before plans were recorded -- and
every one is held to the same arithmetic: the four counts sum to the total, the lists are the
items and nothing else, and a source is never asked about more than it was planned for.
"""

from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate
from starnest.data import Attribute, DataSourceId
from starnest.data_acquisition import (
    Acquired,
    AcquisitionFailure,
    Run,
    RunScope,
    RunStatus,
    SourceAdapter,
    execute_run,
    retry_run,
)
from starnest.storage import PostgresRunStore, PostgresValueStore

from .test_run_store import (
    LIECHTENSTEIN,
    OVERBURDEN,
    OVERCROWDING,
    PORTUGAL,
    ProcessKilled,
    a_figure,
    a_ratio_attribute,
)

pytestmark = pytest.mark.storage

BOTH = [a_ratio_attribute(OVERBURDEN), a_ratio_attribute(OVERCROWDING)]


class Answers(SourceAdapter):
    """A source answering the candidates it covers, with a hook run as it is asked."""

    def __init__(
        self,
        source: str,
        declares: tuple[str, ...],
        covers: tuple[str, ...] = (),
        as_asked: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._source = source
        self._declares = declares
        self._covers = covers
        self._as_asked = as_asked

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._source)

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if self._as_asked is not None:
            await self._as_asked()
        return Acquired(
            values=tuple(
                a_figure(None, str(candidate.id), str(attribute.id), self._source)
                for candidate in candidates
                if str(candidate.id) in self._covers
            )
        )


def pairs(items: Sequence[object]) -> list[tuple[str, str]]:
    return [(item.candidate, item.attribute) for item in items]  # type: ignore[attr-defined]


async def holds_its_arithmetic(pool: AsyncConnectionPool, run: Run) -> None:
    """The guard every scenario passes (map-C04 2.1)."""
    counts = (run.items_completed, run.items_failed, run.items_unanswered, run.items_not_reached)
    assert all(count >= 0 for count in counts)
    assert sum(counts) == run.items_total
    assert len(run.unanswered) == run.items_unanswered
    assert len(run.not_reached) == run.items_not_reached
    assert set(pairs(run.unanswered)).isdisjoint(pairs(run.not_reached))
    if run.status is RunStatus.COMPLETED:
        assert run.items_not_reached == 0
    for reach in run.by_source:
        if run.plan_recorded:
            assert reach.items_planned is not None and reach.items_asked is not None
            assert 0 <= reach.items_asked <= reach.items_planned
        else:
            assert (reach.items_planned, reach.items_asked) == (None, None)
    async with pool.connection() as connection:
        cursor = await connection.execute(
            "SELECT candidate, attribute FROM data_acquisition_run_item "
            "WHERE data_acquisition_run = %s",
            (run.id,),
        )
        items = {tuple(row) for row in await cursor.fetchall()}
    assert set(pairs(run.unanswered)) | set(pairs(run.not_reached)) <= items
    [listed] = [r for r in await PostgresRunStore(pool).read_runs() if r.id == run.id]
    assert (listed.items_total, listed.items_completed, listed.items_failed) == (
        run.items_total,
        run.items_completed,
        run.items_failed,
    )


async def a_sweep(pool: AsyncConnectionPool, *sources: SourceAdapter) -> int:
    """Eurostat, then the World Bank, over Liechtenstein and Portugal; the run's id, however it
    ended."""
    runs = PostgresRunStore(pool)
    try:
        return (
            await execute_run(
                adapters=list(sources),
                attributes=BOTH,
                candidates=[LIECHTENSTEIN, PORTUGAL],
                values=PostgresValueStore(pool),
                runs=runs,
                level="country",
                spend_cap_eur=Decimal("5.00"),
            )
        ).id
    except ProcessKilled:
        killed = await runs.run_in_flight()
        assert killed is not None
        await runs.sweep_abandoned_runs(finished_at=datetime.now(UTC))
        return killed


def eurostat(as_asked: Callable[[], Awaitable[None]] | None = None) -> Answers:
    """Answers Portugal for both attributes and has no row for Liechtenstein."""
    return Answers(
        "eurostat", (OVERBURDEN, OVERCROWDING), covers=(str(PORTUGAL.id),), as_asked=as_asked
    )


def world_bank(as_asked: Callable[[], Awaitable[None]] | None = None) -> Answers:
    """Planned for the overcrowding rate only, and has no row for anybody."""
    return Answers("world_bank", (OVERCROWDING,), as_asked=as_asked)


class TestACompletedRun:
    async def test_it_has_nothing_not_reached_and_every_source_asked_in_full(
        self, pool: AsyncConnectionPool
    ) -> None:
        run = await PostgresRunStore(pool).read_run(await a_sweep(pool, eurostat(), world_bank()))

        await holds_its_arithmetic(pool, run)
        assert run.status is RunStatus.COMPLETED
        assert pairs(run.unanswered) == [
            (str(LIECHTENSTEIN.id), OVERBURDEN),
            (str(LIECHTENSTEIN.id), OVERCROWDING),
        ]
        assert run.not_reached == ()
        assert {(r.data_source, r.items_planned, r.items_asked) for r in run.by_source} == {
            ("eurostat", 4, 4),
            ("world_bank", 2, 2),
        }

    async def test_it_serves_the_ceiling_and_the_cap_it_started_with(
        self, pool: AsyncConnectionPool
    ) -> None:
        run = await PostgresRunStore(pool).read_run(await a_sweep(pool, eurostat()))

        assert run.plan_recorded is True
        assert (run.estimate_ceiling_eur, run.spend_cap_eur, run.accepted_uncapped) == (
            Decimal(0),
            Decimal("5.00"),
            False,
        )


class TestARunThatDidNotFinish:
    """The World Bank is planned for Liechtenstein's overcrowding rate and is never asked."""

    async def test_a_halted_runs_unasked_items_are_not_reached(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Mutation: ignoring `finished_at` reads Liechtenstein's overcrowding rate unanswered,
        "retrying changes nothing", about a question the World Bank was never asked."""
        runs = PostgresRunStore(pool)

        async def stop_after_this_source() -> None:
            running = await runs.run_in_flight()
            assert running is not None
            await runs.request_stop(running)

        run = await runs.read_run(
            await a_sweep(pool, eurostat(stop_after_this_source), world_bank())
        )

        await holds_its_arithmetic(pool, run)
        assert run.status is RunStatus.HALTED_BY_USER
        assert pairs(run.unanswered) == [(str(LIECHTENSTEIN.id), OVERBURDEN)]
        assert pairs(run.not_reached) == [(str(LIECHTENSTEIN.id), OVERCROWDING)]

    async def test_a_source_never_begun_is_listed_with_nothing_asked(
        self, pool: AsyncConnectionPool
    ) -> None:
        runs = PostgresRunStore(pool)

        async def stop_after_this_source() -> None:
            running = await runs.run_in_flight()
            assert running is not None
            await runs.request_stop(running)

        run = await runs.read_run(
            await a_sweep(pool, eurostat(stop_after_this_source), world_bank())
        )

        [never_begun] = [r for r in run.by_source if r.data_source == "world_bank"]
        assert (never_begun.items_planned, never_begun.items_asked) == (2, 0)
        assert (never_begun.items_stored, never_begun.items_failed) == (0, 0)

    async def test_a_run_killed_mid_way_keeps_what_it_finished_and_reaches_nothing_more(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The process dies inside the World Bank's fetch, and the next boot sweeps the run."""

        async def the_process_dies() -> None:
            raise ProcessKilled

        run = await PostgresRunStore(pool).read_run(
            await a_sweep(pool, eurostat(), world_bank(the_process_dies))
        )

        await holds_its_arithmetic(pool, run)
        assert run.status is RunStatus.FAILED
        assert pairs(run.unanswered) == [(str(LIECHTENSTEIN.id), OVERBURDEN)]
        assert pairs(run.not_reached) == [(str(LIECHTENSTEIN.id), OVERCROWDING)]

    async def test_a_running_run_reports_an_item_unanswered_once_every_planned_source_has_finished(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Read mid-run, from inside the World Bank's fetch: Eurostat was the only source planned
        for the overburden rate and has finished it, so Liechtenstein's is already unanswered."""
        runs = PostgresRunStore(pool)
        seen: list[Run] = []

        async def read_the_run() -> None:
            running = await runs.run_in_flight()
            assert running is not None
            seen.append(await runs.read_run(running))

        await a_sweep(pool, eurostat(), world_bank(read_the_run))

        [mid_run] = seen
        await holds_its_arithmetic(pool, mid_run)
        assert mid_run.status is RunStatus.RUNNING
        assert pairs(mid_run.unanswered) == [(str(LIECHTENSTEIN.id), OVERBURDEN)]
        assert pairs(mid_run.not_reached) == [(str(LIECHTENSTEIN.id), OVERCROWDING)]


class TestARetry:
    async def test_a_retry_plans_its_pairs_and_finishes_every_one(
        self, pool: AsyncConnectionPool
    ) -> None:
        runs, values = PostgresRunStore(pool), PostgresValueStore(pool)
        first = await a_sweep(pool, Answers("eurostat", (OVERBURDEN,)))
        await runs.record_failures(
            first,
            [
                AcquisitionFailure(
                    OVERBURDEN, "503", candidate="country.portugal", data_source="eurostat"
                )
            ],
        )

        retried = await retry_run(
            failed=await runs.read_run(first),
            adapters=[eurostat()],
            attributes=BOTH,
            candidates=[LIECHTENSTEIN, PORTUGAL],
            values=values,
            runs=runs,
        )

        run = await runs.read_run(retried.id)
        await holds_its_arithmetic(pool, run)
        assert (run.items_total, run.items_completed, run.items_not_reached) == (1, 1, 0)
        assert [(r.data_source, r.items_planned, r.items_asked) for r in run.by_source] == [
            ("eurostat", 1, 1)
        ]


class TestARunBeforePlansWereRecorded:
    """A run opened the way runs were before `0512` has no plan to read, and says so."""

    async def a_run_with_no_plan(self, pool: AsyncConnectionPool) -> int:
        runs = PostgresRunStore(pool)
        run = await runs.start_run(
            RunScope(
                level="country",
                candidates=(str(LIECHTENSTEIN.id), str(PORTUGAL.id)),
                attributes=(OVERBURDEN,),
            ),
            triggered_by="before 0512",
        )
        await PostgresValueStore(pool).append([a_figure(run, str(PORTUGAL.id), OVERBURDEN)])
        return run

    async def test_it_reads_not_recorded_never_zero(self, pool: AsyncConnectionPool) -> None:
        run = await PostgresRunStore(pool).read_run(await self.a_run_with_no_plan(pool))

        await holds_its_arithmetic(pool, run)
        assert run.plan_recorded is False
        assert (run.estimate_ceiling_eur, run.spend_cap_eur, run.accepted_uncapped) == (
            None,
            None,
            None,
        )
        assert [(r.data_source, r.items_planned, r.items_asked) for r in run.by_source] == [
            ("eurostat", None, None)
        ]

    @pytest.mark.parametrize(
        ("status", "unanswered", "not_reached"),
        [
            (RunStatus.COMPLETED, 1, 0),
            (RunStatus.FAILED, 0, 1),
            (RunStatus.RUNNING, 0, 1),
        ],
    )
    async def test_its_empty_items_are_unanswered_only_when_it_completed(
        self, pool: AsyncConnectionPool, status: RunStatus, unanswered: int, not_reached: int
    ) -> None:
        runs = PostgresRunStore(pool)
        run = await self.a_run_with_no_plan(pool)
        if status is not RunStatus.RUNNING:
            await runs.finish_run(run, status=status, finished_at=datetime.now(UTC))

        read = await runs.read_run(run)

        await holds_its_arithmetic(pool, read)
        assert (read.items_unanswered, read.items_not_reached) == (unanswered, not_reached)
