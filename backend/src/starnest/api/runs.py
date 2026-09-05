"""Data acquisition through the API: plan it, start it, watch it.

`arch.md` 8.4. The client `POST`s, gets a run id, and polls -- no socket, no streaming, no
callback, because the run record already holds everything a screen shows.

**Planning is separate from running, and free.** `reqs.md` 6.3 requires the count and the cost
to be shown *before* anything is fetched, and a plan that ran the thing to find out would defeat
the purpose. For Eurostat the answer is always zero euros, which is not a reason to skip the
step: the estimate exists so that a source which does cost money cannot be started by accident.

**Runs are the one paginated list.** Values, runs and evaluations grow without bound; candidates
and attributes are bounded by the catalog and come back whole (`arch.md` 7.6).
"""

from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import Adapters, Candidates, Catalog, Runs, Values
from starnest.data_acquisition import Run, execute_run

router = APIRouter(tags=["acquisition"])


class RunScopeBody(BaseModel):
    """What a run is asked to cover. Null means everything at the level."""

    level: str
    candidates: tuple[str, ...] | None = None
    attributes: tuple[str, ...] | None = None


class BySourceBody(BaseModel):
    data_source: str
    items: int


class RunPlanBody(BaseModel):
    items_total: int
    llm_call_count: int
    estimated_cost_eur: float
    by_source: tuple[BySourceBody, ...] = ()


class RunBody(ContractBody):
    id: int
    run_status: str
    started_at: datetime
    triggered_by: str
    finished_at: datetime | None = None
    llm_call_count: int = 0
    cost_eur: float = 0


class ProgressBody(BaseModel):
    items_total: int
    items_completed: int
    items_failed: int


class FailureBody(BaseModel):
    candidate: str
    attribute: str
    error_message: str


class RunDetailBody(RunBody):
    scope: RunScopeBody | None = None
    progress: ProgressBody | None = None
    failures: tuple[FailureBody, ...] = ()


class RunsBody(BaseModel):
    items: tuple[RunBody, ...]
    total: int


@router.post("/data-acquisition-runs/plan", operation_id="planRun", response_model=RunPlanBody)
async def plan_run(
    scope: RunScopeBody, adapters: Adapters, candidates: Candidates, catalog: Catalog
) -> RunPlanBody:
    """What a run would do, without doing any of it.

    Counts the work as the cross product of candidates and answerable attributes, per source.
    An attribute no adapter can supply is not counted: promising to fetch something nothing can
    fetch would make the estimate a wish.
    """
    roster = await _candidates_in(scope, candidates)
    wanted = await _attributes_in(scope, catalog)

    by_source = []
    items_total = 0
    for adapter in adapters:
        answerable = [a for a in wanted if a.id in adapter.attributes]
        items = len(answerable) * len(roster)
        items_total += items
        if items:
            by_source.append(BySourceBody(data_source=str(adapter.data_source), items=items))

    return RunPlanBody(
        items_total=items_total,
        # Both zero while Eurostat is the only source. The LLM path is `reqs.md` 6.10 and the
        # city level, and reporting a guess here would be the invented number the estimate
        # exists to prevent.
        llm_call_count=0,
        estimated_cost_eur=0,
        by_source=tuple(by_source),
    )


@router.post(
    "/data-acquisition-runs", operation_id="startRun", status_code=202, response_model=RunBody
)
async def start_run(
    scope: RunScopeBody,
    adapters: Adapters,
    candidates: Candidates,
    catalog: Catalog,
    values: Values,
    runs: Runs,
) -> RunBody:
    """Start a run, and answer with it.

    **It runs inline today, and the response carries a finished run.** 202 is still right --
    the work was accepted and the client polls the id either way -- but claiming the run is in
    flight when it is not would be a lie a screen could act on. One source and 31 countries take
    a few seconds, and a background task would add a lifecycle to manage for no benefit anybody
    can currently see. Making it genuinely asynchronous is a change here and nowhere else,
    because the run record already holds everything the polling endpoint reads (`arch.md` 8.4).

    The run row exists before any figure is fetched, so a process that dies mid-run leaves a
    visibly unfinished run rather than nothing at all.
    """
    roster = await _candidates_in(scope, candidates)
    wanted = await _attributes_in(scope, catalog)

    started = await execute_run(
        adapter=adapters[0],
        attributes=wanted,
        candidates=roster,
        values=values,
        runs=runs,
        level=scope.level,
    )
    return _run_body(started)


@router.get("/data-acquisition-runs", operation_id="listRuns", response_model=RunsBody)
async def list_runs(runs: Runs, limit: int = 20, offset: int = 0) -> RunsBody:
    """Recent runs, newest first. Headers only -- a scope and its failures are the detail read."""
    return RunsBody(
        items=tuple(_run_body(run) for run in await runs.read_runs(limit=limit, offset=offset)),
        total=await runs.count_runs(),
    )


@router.get("/data-acquisition-runs/{run_id}", operation_id="getRun", response_model=RunDetailBody)
async def get_run(run_id: int, runs: Runs) -> RunDetailBody:
    """One run with its scope, progress and failures -- what a screen polls."""
    run = await runs.read_run(run_id)
    return RunDetailBody(
        **_run_body(run).model_dump(),
        scope=(
            RunScopeBody(
                level=run.scope.level,
                candidates=run.scope.candidates,
                attributes=run.scope.attributes,
            )
            if run.scope
            else None
        ),
        progress=ProgressBody(
            items_total=run.items_total,
            items_completed=run.items_completed,
            items_failed=len(run.failures),
        ),
        failures=tuple(
            FailureBody(
                candidate=str(failure.candidate),
                attribute=str(failure.attribute),
                error_message=failure.reason,
            )
            for failure in run.failures
        ),
    )


async def _candidates_in(scope: RunScopeBody, candidates: Candidates) -> list:
    """The candidates a scope names, or every one at the level.

    Null means everything, which is not the same as nothing -- a full sweep and a no-op are the
    two things a client most needs kept apart.
    """
    roster = await candidates.read_candidates(level=scope.level)
    if scope.candidates is None:
        return list(roster)
    wanted = set(scope.candidates)
    return [candidate for candidate in roster if str(candidate.id) in wanted]


async def _attributes_in(scope: RunScopeBody, catalog: Catalog) -> list:
    catalogued = await catalog.read_attributes(level=scope.level)
    if scope.attributes is None:
        return list(catalogued)
    wanted = set(scope.attributes)
    return [attribute for attribute in catalogued if str(attribute.id) in wanted]


def _run_body(run: Run) -> RunBody:
    return RunBody(
        id=run.id,
        run_status=str(run.status),
        started_at=run.started_at,
        triggered_by=run.triggered_by,
        finished_at=run.finished_at,
        llm_call_count=run.llm_call_count,
        cost_eur=float(run.cost_eur),
    )
