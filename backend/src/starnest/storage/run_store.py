"""`RunStore` against PostgreSQL: what a run planned, did and failed at.

`arch.md` 6.3. The scope is written **expanded** -- one row per candidate and one per attribute
-- rather than as "everything at this level". A scope recorded as "everything" would mean
something different after the catalog grew, and both selective retry and the dry-run estimate
need to know what was actually asked for on the day.

One statement serves a poll (`arch.md` 8.4): status, progress, counts and lists arrive together,
from one snapshot (ST-11), so a commit landing mid-poll cannot split a count from its list -- and
a screen polling a live run does not cost four queries a second.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from psycopg.errors import UniqueViolation
from psycopg_pool import AsyncConnectionPool

from starnest.data import DataSourceId
from starnest.data_acquisition import (
    STAND_IN,
    AcquisitionFailure,
    Gap,
    Holdings,
    MonthlySpend,
    Reconfirmation,
    ResearchSpend,
    Run,
    RunAlreadyInFlightError,
    RunPlan,
    RunScope,
    RunStatus,
    RunStore,
    SourceReach,
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

    async def start_run(
        self, scope: RunScope, *, triggered_by: str, plan: RunPlan | None = None
    ) -> int:
        """Open the run and write its scope and its plan, in one transaction.

        Opened before anything is fetched: a run that dies mid-flight must still be visible as
        one that started and never finished, which is what the abandoned-run sweep looks for
        (`arch.md` 9.2). A run written only on success would leave nothing to sweep.
        """
        if not scope.candidates or not scope.attributes:
            raise ValueError(
                "a run's scope is stored expanded, so the candidates and attributes must "
                "already have been resolved from the level"
            )
        started_at = datetime.now(tz=UTC)
        async with acquire(self._pool) as connection:
            try:
                row = await self._queries.insert_run(
                    connection,
                    started_at=started_at,
                    triggered_by=triggered_by,
                    run_status=str(RunStatus.RUNNING),
                    level=scope.level,
                    plan_recorded_at=None if plan is None else started_at,
                    estimate_ceiling_eur=None if plan is None else plan.estimate_ceiling_eur,
                    spend_cap_eur=None if plan is None else plan.spend_cap_eur,
                    accepted_uncapped=None if plan is None else plan.accepted_uncapped,
                )
            except UniqueViolation as clash:
                # Another run won the race to the one `running` slot the `0498` partial unique
                # index allows (ST-01). The caller's own `run_in_flight` check may have passed --
                # the point of the index is that it does not have to -- so this is the same
                # refusal, raised where the database made it certain.
                raise RunAlreadyInFlightError(
                    "another run is already in flight, and one household runs one pass at a "
                    "time (reqs.md 10). Poll the running run rather than starting another."
                ) from clash
            await self._queries.insert_run_candidates(
                connection, data_acquisition_run=row.id, candidates=list(scope.candidates)
            )
            await self._queries.insert_run_attributes(
                connection, data_acquisition_run=row.id, attributes=list(scope.attributes)
            )
            # The exact pairs the run asks about, the uniform truth its item counts read (BE-11).
            # A sweep names no pairs and gets the rectangle its two lists span; a retry names only
            # the pairs it is going back to, so a corner no source is asked about is never a phantom
            # unanswered item. Both are written in this same transaction as the scope lists.
            if scope.pairs is None:
                await self._queries.insert_run_items_as_rectangle(
                    connection, data_acquisition_run=row.id
                )
            else:
                await self._queries.insert_run_items(
                    connection,
                    data_acquisition_run=row.id,
                    pairs=json.dumps([{"candidate": c, "attribute": a} for c, a in scope.pairs]),
                )
            # After the scope's attributes, which each plan row's key names (0512).
            if plan is not None and plan.items_planned:
                await self._queries.insert_run_plan(
                    connection,
                    data_acquisition_run=row.id,
                    planned=json.dumps(
                        [
                            {"data_source": source, "attribute": attribute, "items_planned": n}
                            for (source, attribute), n in plan.items_planned.items()
                        ]
                    ),
                )
        return int(row.id)

    async def mark_asked(self, run: int, data_source: DataSourceId, attribute: str) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.mark_run_plan_asked(
                connection,
                data_acquisition_run=run,
                data_source=str(data_source),
                attribute=str(attribute),
                finished_at=datetime.now(tz=UTC),
            )

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

    async def request_stop(self, run: int) -> bool:
        """Stamp the request on the row, and say whether there was a running run to stamp.

        The loop reads it between items, so a stop never interrupts a fetch in flight and never
        loses what had already been written.
        """
        async with acquire(self._pool) as connection:
            row = await self._queries.request_run_stop(
                connection, data_acquisition_run=run, asked_at=datetime.now(tz=UTC)
            )
        return row is not None

    async def stop_was_requested(self, run: int) -> bool:
        async with acquire(self._pool) as connection:
            return bool(
                await self._queries.select_run_stop_requested(connection, data_acquisition_run=run)
            )

    async def add_spend(self, run: int, *, calls: int, cost_eur: Decimal) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.add_run_spend(
                connection,
                data_acquisition_run=run,
                llm_call_count=calls,
                cost_eur=cost_eur,
            )

    async def record_research_spend(self, spend: ResearchSpend) -> None:
        """One row per billed call, committed on its own so nothing after it can take it back."""
        async with acquire(self._pool) as connection:
            await self._queries.insert_research_spend(
                connection,
                match_rule=str(spend.match_rule),
                candidate=str(spend.candidate),
                data_source=str(spend.data_source),
                llm_call_count=spend.llm_call_count,
                cost_eur=spend.cost_eur,
            )

    async def read_holdings(
        self,
        *,
        level: str,
        declared: Sequence[tuple[str, str]],
        since: datetime,
    ) -> Holdings:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_holdings(
                connection,
                level=level,
                declared=json.dumps([{"data_source": s, "attribute": a} for s, a in declared]),
                stand_in_source=str(STAND_IN),
                since=since,
            )
        gaps: dict[str, list[Gap]] = {"failed": [], "unanswered": [], "not_reached": []}
        for gap in row.gaps:
            gaps[gap["outcome"]].append(_gap_from(gap))
        return Holdings(
            level=level,
            pairs_total=int(row.pairs_total),
            values_stored=int(row.values_stored),
            values_past_allowed_age=int(row.values_past_allowed_age),
            values_older_than_refetch_age=row.values_older_than_refetch_age,
            spent=MonthlySpend(
                since=since,
                runs_eur=Decimal(str(row.runs_eur)),
                research_eur=Decimal(str(row.research_eur)),
            ),
            failed=tuple(gaps["failed"]),
            unanswered=tuple(gaps["unanswered"]),
            not_reached=tuple(gaps["not_reached"]),
        )

    async def read_run(self, run: int) -> Run:
        """Everything a poll shows, read by one statement and so from one snapshot (ST-11)."""
        async with acquire(self._pool) as connection:
            row = await self._queries.select_run(connection, data_acquisition_run=run)
        if row is None:
            raise UnknownRunError(f"there is no data acquisition run numbered {run}")
        return _run_from(row)

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

    async def last_retrieved(
        self,
        *,
        level: str | None = None,
        candidates: Sequence[str] = (),
        attributes: Sequence[str] = (),
    ) -> Mapping[tuple[str, str], datetime]:
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_last_retrieval_dates(
                    connection,
                    level=level,
                    candidates=list(candidates) or None,
                    attributes=list(attributes) or None,
                )
            ]
        return {(row.candidate, row.attribute): row.last_retrieval_date for row in rows}

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


def _run_from(row: Any) -> Run:
    """A detail row, its lists arriving as JSON arrays of objects beside the counts."""
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
        # **The same two counts the history row carries**, derived from the scope this read
        # already has rather than left at zero. A detail that reported a scope of nothing while
        # listing its candidates by name would disagree with itself, and with its own list row.
        scope_candidates=len(row.scope_candidates),
        scope_attributes=len(row.scope_attributes),
        items_total=int(row.items_total),
        items_completed=int(row.items_completed),
        items_failed=int(row.items_failed),
        items_unanswered=int(row.items_unanswered),
        stop_requested_at=row.stop_requested_at,
        failures=tuple(
            AcquisitionFailure(
                attribute=failure["attribute"],
                candidate=failure["candidate"],
                reason=failure["error_message"],
                data_source=DataSourceId(failure["data_source"]),
            )
            for failure in row.failures
        ),
        unanswered=tuple(
            UnansweredItem(candidate=item["candidate"], attribute=item["attribute"])
            for item in row.unanswered
        ),
        by_source=tuple(
            SourceReach(
                data_source=DataSourceId(reach["data_source"]),
                items_stored=int(reach["items_stored"]),
                items_failed=int(reach["items_failed"]),
            )
            for reach in row.by_source
        ),
        reconfirmed=tuple(
            Reconfirmation(
                data_source=DataSourceId(reconfirmed["data_source"]),
                candidate=reconfirmed["candidate"],
                attribute=reconfirmed["attribute"],
                value=reconfirmed["value"],
            )
            for reconfirmed in row.reconfirmed
        ),
    )


def _gap_from(gap: Mapping[str, Any]) -> Gap:
    return Gap(
        candidate=gap["candidate"],
        attribute=gap["attribute"],
        data_acquisition_run=gap["data_acquisition_run"],
        failures=tuple(
            AcquisitionFailure(
                attribute=gap["attribute"],
                candidate=gap["candidate"],
                reason=failure["error_message"],
                data_source=DataSourceId(failure["data_source"]),
            )
            for failure in gap["failures"] or ()
        ),
    )


def _run_header_from(row: Any) -> Run:
    """A list row: what each pass reached, without its failures listed one by one.

    **The counts, not the contents.** A history row answers "did this one fill anything", which
    three integers answer; which source failed on which attribute is the detail's question, and
    reading it for every row would be a scan per page.
    """
    candidates = int(row.scope_candidates)
    attributes = int(row.scope_attributes)
    total = int(row.items_total)
    completed = int(row.items_completed)
    failed = int(row.items_failed)
    return Run(
        id=int(row.id),
        status=RunStatus(row.run_status),
        started_at=row.started_at,
        triggered_by=row.triggered_by,
        finished_at=row.finished_at,
        llm_call_count=int(row.llm_call_count),
        cost_eur=Decimal(str(row.cost_eur)),
        scope_candidates=candidates,
        scope_attributes=attributes,
        items_total=total,
        items_completed=completed,
        items_failed=failed,
        # The third count closes the arithmetic (Q217) and is derived rather than read: asked
        # about, and neither answered nor failed.
        items_unanswered=max(0, total - completed - failed),
        # On the history row too: a run still `running` with a stop asked for is one the list
        # should not describe as simply running.
        stop_requested_at=row.stop_requested_at,
    )
