"""`RunStore` against PostgreSQL: what a run planned, did and failed at.

`arch.md` 6.3. The scope is written **expanded** -- one row per candidate and one per attribute
-- rather than as "everything at this level". A scope recorded as "everything" would mean
something different after the catalog grew, and both selective retry and the dry-run estimate
need to know what was actually asked for on the day.

One read serves a poll (`arch.md` 8.4): status, progress and counts arrive together, because a
screen polling a live run should not cost four queries a second.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from psycopg_pool import AsyncConnectionPool

from starnest.data import DataSourceId
from starnest.data_acquisition import (
    AcquisitionFailure,
    Run,
    RunScope,
    RunStatus,
    RunStore,
    UnansweredItem,
    UnknownRunError,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresRunStore(RunStore):
    """The run record, as the four tables of `0004-data-acquisition.sql` hold it."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def start_run(self, scope: RunScope, *, triggered_by: str) -> int:
        """Open the run and write its scope, in one transaction.

        Opened before anything is fetched: a run that dies mid-flight must still be visible as
        one that started and never finished, which is what the abandoned-run sweep looks for
        (`arch.md` 9.2). A run written only on success would leave nothing to sweep.
        """
        if not scope.candidates or not scope.attributes:
            raise ValueError(
                "a run's scope is stored expanded, so the candidates and attributes must "
                "already have been resolved from the level"
            )
        async with acquire(self._pool) as connection:
            row = await self._queries.insert_run(
                connection,
                started_at=datetime.now(tz=UTC),
                triggered_by=triggered_by,
                run_status=str(RunStatus.RUNNING),
                level=scope.level,
            )
            await self._queries.insert_run_candidates(
                connection, data_acquisition_run=row.id, candidates=list(scope.candidates)
            )
            await self._queries.insert_run_attributes(
                connection, data_acquisition_run=row.id, attributes=list(scope.attributes)
            )
        return int(row.id)

    async def finish_run(self, run: int, *, status: RunStatus, finished_at: datetime) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.update_run_status(
                connection,
                data_acquisition_run=run,
                run_status=str(status),
                finished_at=finished_at,
            )

    async def record_failures(self, run: int, failures: Sequence[AcquisitionFailure]) -> None:
        """One row per source per (candidate, attribute), which is the unit a retry addresses.

        **Refuses a failure that does not say where and from whom.** The run itemises a
        whole-source failure against every candidate it asked about before it gets here, and
        stamps every failure with its source; one arriving without either is a bug upstream, and
        storing it against a guessed candidate would be inventing a fact about a place.
        """
        if not failures:
            return
        unaddressed = [f for f in failures if f.candidate is None or f.data_source is None]
        if unaddressed:
            raise ValueError(
                f"{len(unaddressed)} failures name no candidate or no source, so none can be "
                f"retried: the first is {unaddressed[0]!r}"
            )
        async with acquire(self._pool) as connection:
            for failure in failures:
                await self._queries.upsert_run_failure(
                    connection,
                    data_acquisition_run=run,
                    data_source=str(failure.data_source),
                    candidate=failure.candidate,
                    attribute=str(failure.attribute),
                    error_message=failure.reason,
                )

    async def add_spend(self, run: int, *, calls: int, cost_eur: Decimal) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.add_run_spend(
                connection,
                data_acquisition_run=run,
                llm_call_count=calls,
                cost_eur=cost_eur,
            )

    async def read_run(self, run: int) -> Run:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_run(connection, data_acquisition_run=run)
            if row is None:
                raise UnknownRunError(f"there is no data acquisition run numbered {run}")
            failures = [
                failure
                async for failure in self._queries.select_run_failures(
                    connection, data_acquisition_run=run
                )
            ]
            unanswered = [
                item
                async for item in self._queries.select_run_unanswered(
                    connection, data_acquisition_run=run
                )
            ]
        return _run_from(row, failures, unanswered)

    async def read_runs(self, *, limit: int = 20, offset: int = 0) -> tuple[Run, ...]:
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_runs(
                    connection, limit_rows=limit, offset_rows=offset
                )
            ]
        return tuple(_run_header_from(row) for row in rows)

    async def count_runs(self) -> int:
        async with acquire(self._pool) as connection:
            return int(await self._queries.count_runs(connection))

    async def run_in_flight(self) -> int | None:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_run_in_flight(connection)
        return None if row is None else int(row.id)

    async def sweep_abandoned_runs(self, *, finished_at: datetime) -> tuple[int, ...]:
        async with acquire(self._pool) as connection:
            # Read as a select rather than as an update, because `RETURNING id` gives one row
            # per run swept -- or none at all on the ordinary boot, where nothing was in flight.
            swept = [
                int(row.id)
                async for row in self._queries.sweep_abandoned_runs(
                    connection, finished_at=finished_at
                )
            ]
        return tuple(swept)


def _run_from(row: Any, failures: Sequence[Any], unanswered: Sequence[Any]) -> Run:
    return Run(
        id=int(row.id),
        status=RunStatus(row.run_status),
        started_at=row.started_at,
        triggered_by=row.triggered_by,
        finished_at=row.finished_at,
        llm_call_count=int(row.llm_call_count),
        cost_eur=Decimal(str(row.cost_eur)),
        scope=RunScope(
            level=row.level,
            candidates=tuple(row.scope_candidates),
            attributes=tuple(row.scope_attributes),
        ),
        items_total=int(row.items_total),
        items_completed=int(row.items_completed),
        items_failed=int(row.items_failed),
        items_unanswered=int(row.items_unanswered),
        failures=tuple(
            AcquisitionFailure(
                attribute=failure.attribute,
                candidate=failure.candidate,
                reason=failure.error_message,
                data_source=DataSourceId(failure.data_source),
            )
            for failure in failures
        ),
        unanswered=tuple(
            UnansweredItem(candidate=item.candidate, attribute=item.attribute)
            for item in unanswered
        ),
    )


def _run_header_from(row: Any) -> Run:
    """A list row, which carries no scope and no failures -- the list is a list."""
    return Run(
        id=int(row.id),
        status=RunStatus(row.run_status),
        started_at=row.started_at,
        triggered_by=row.triggered_by,
        finished_at=row.finished_at,
        llm_call_count=int(row.llm_call_count),
        cost_eur=Decimal(str(row.cost_eur)),
    )
