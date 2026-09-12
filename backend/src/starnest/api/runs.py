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
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import (
    Adapters,
    Candidates,
    Catalog,
    Households,
    Runs,
    Values,
)
from starnest.data_acquisition import (
    NOTHING,
    Run,
    ask_again,
    asked_this_run,
    execute_run,
    retry_run,
)

router = APIRouter(tags=["acquisition"])


class RunScopeBody(BaseModel):
    """What a run is asked to cover. Null means everything at the level."""

    level: str
    candidates: tuple[str, ...] | None = None
    attributes: tuple[str, ...] | None = None


class RunRequestBody(RunScopeBody):
    """A scope, and whether an uncapped run is accepted (`reqs.md` 6.3).

    **Per request, never stored.** A cap is a setting; accepting the absence of one is a
    sentence about this one run. Remembering it would turn a deliberate act into a default.
    """

    accept_uncapped_spend: bool = False


class BySourceBody(BaseModel):
    data_source: str
    items: int


class RunPlanBody(BaseModel):
    items_total: int
    llm_call_count: int
    estimated_cost_eur: float
    by_source: tuple[BySourceBody, ...] = ()
    # What the euro figure rests on, when there is one. A cost with no stated assumptions is the
    # plausible-looking number this application exists to avoid (`estimate.py`).
    estimate_basis: str | None = None


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
    # The three sum to `items_total`. Before Q217 they did not: an item every source answered
    # without having a row for that candidate belonged to none of them, and the run reported
    # nothing failed about a run that learned nothing.
    items_unanswered: int


class FailureBody(BaseModel):
    data_source: str
    candidate: str
    attribute: str
    error_message: str


class UnansweredBody(BaseModel):
    """An item nobody answered. No source, because none failed -- see `store.UnansweredItem`."""

    candidate: str
    attribute: str


class RetryBody(BaseModel):
    """Which part of the run to go over again. Absent means the failures, as it always did."""

    items: Literal["failed", "unanswered"] = "failed"


class RunDetailBody(RunBody):
    scope: RunScopeBody | None = None
    progress: ProgressBody | None = None
    failures: tuple[FailureBody, ...] = ()
    unanswered: tuple[UnansweredBody, ...] = ()


class RunsBody(BaseModel):
    items: tuple[RunBody, ...]
    total: int


@router.post("/data-acquisition-runs/plan", operation_id="planRun", response_model=RunPlanBody)
async def plan_run(
    scope: RunScopeBody, adapters: Adapters, candidates: Candidates, catalog: Catalog
) -> RunPlanBody:
    """What a run would do, without doing any of it.

    Counts the work as the cross product of candidates and answerable attributes. An attribute no
    adapter can supply is not counted: promising to fetch something nothing can fetch would make
    the estimate a wish.

    **An item is one candidate and one attribute**, however many sources answer it -- the unit a
    run's progress counts and a retry addresses. `by_source` says what each source will be asked,
    so where two answer the same attribute its entries sum to more than `items_total`, which is
    the truth: the tax rate for Germany is one item, asked of OECD and of the estimate.
    """
    roster = await _candidates_in(scope, candidates)
    wanted = await _attributes_in(scope, catalog)

    # The plan counts the same sources the run would ask, so an estimate for an unscoped run
    # does not promise paid work that would not happen.
    planned = asked_this_run(adapters, attributes_named=scope.attributes is not None)
    by_source = []
    # Each source prices its own share, because each is the only thing that knows what it
    # charges -- and a free one prices nothing, which is every structured source.
    estimate = NOTHING
    for adapter in planned:
        items = len([a for a in wanted if a.id in adapter.attributes]) * len(roster)
        if items:
            by_source.append(BySourceBody(data_source=str(adapter.data_source), items=items))
            estimate = estimate + adapter.estimate_for(items)
    answerable = [a for a in wanted if any(a.id in adapter.attributes for adapter in planned)]

    return RunPlanBody(
        items_total=len(answerable) * len(roster),
        llm_call_count=estimate.calls,
        estimated_cost_eur=float(estimate.cost_eur),
        by_source=tuple(by_source),
        estimate_basis=estimate.basis or None,
    )


@router.post(
    "/data-acquisition-runs", operation_id="startRun", status_code=202, response_model=RunBody
)
async def start_run(
    scope: RunRequestBody,
    adapters: Adapters,
    candidates: Candidates,
    catalog: Catalog,
    values: Values,
    runs: Runs,
    households: Households,
) -> RunBody:
    """Start a run, and answer with it.

    **Money first, if any source charges.** A run that can spend with no cap set is refused
    with 409 unless the request accepts an uncapped one -- nothing here invents a ceiling
    (`reqs.md` 6.3).

    **It runs inline today, and the response carries a finished run.** 202 is still right --
    the work was accepted and the client polls the id either way -- but claiming the run is in
    flight when it is not would be a lie a screen could act on. A full sweep of every source
    fits in one request, and a background task would add a lifecycle to manage for no benefit
    anybody can currently see. Making it genuinely asynchronous is a change here and nowhere else,
    because the run record already holds everything the polling endpoint reads (`arch.md` 8.4).

    The run row exists before any figure is fetched, so a process that dies mid-run leaves a
    visibly unfinished run rather than nothing at all.
    """
    roster = await _candidates_in(scope, candidates)
    wanted = await _attributes_in(scope, catalog)
    # A source that charges is asked only when the run names the attributes it wants: a sweep
    # over a level asks the free sources for whole indicators, and asking a paid one the same
    # way would be hundreds of calls nobody chose (`asked_this_run`).
    asked = asked_this_run(adapters, attributes_named=scope.attributes is not None)
    # The cap is a setting the household edits (`reqs.md` 3.10) and is read per run, so a cap
    # set after a refusal takes effect on the next request rather than at the next restart.
    cap = (await households.get_settings()).run_spend_cap_eur

    started = await execute_run(
        adapters=asked,
        attributes=wanted,
        candidates=roster,
        values=values,
        runs=runs,
        level=scope.level,
        stand_ins=await catalog.read_stand_ins(level=scope.level),
        spend_cap_eur=cap,
        uncapped_is_accepted=scope.accept_uncapped_spend,
    )
    return _run_body(started)


@router.post(
    "/data-acquisition-runs/{run_id}/retry",
    operation_id="retryRun",
    status_code=202,
    response_model=RunBody,
)
async def retry(
    run_id: int,
    adapters: Adapters,
    candidates: Candidates,
    catalog: Catalog,
    values: Values,
    runs: Runs,
    body: RetryBody | None = None,
) -> RunBody:
    """A **new** run over part of the run named, which keeps its own record either way.

    `reqs.md` 6.4 and Q217. **Two different acts through one resource**, because both create a
    run over a subset of an earlier one's scope:

    - `failed` (the default) asks only the sources that failed, only about what they failed on.
    - `unanswered` asks again about the items that produced neither a figure nor a failure.
      There is no source to narrow to -- none failed -- so every source that can answer those
      attributes is asked.

    A run with nothing of the kind asked for is refused with 409: a run over an empty scope
    would be a no-op recorded as though it were work.
    """
    earlier = await runs.read_run(run_id)
    level = earlier.scope.level if earlier.scope else None
    attributes = await catalog.read_attributes(level=level)
    roster = await candidates.read_candidates(level=level)
    stand_ins = await catalog.read_stand_ins(level=level)

    if (body or RetryBody()).items == "unanswered":
        asked = await ask_again(
            run=earlier,
            adapters=adapters,
            attributes=attributes,
            candidates=roster,
            values=values,
            runs=runs,
            stand_ins=stand_ins,
        )
        return _run_body(asked)

    retried = await retry_run(
        failed=earlier,
        adapters=adapters,
        attributes=attributes,
        candidates=roster,
        values=values,
        runs=runs,
        stand_ins=stand_ins,
    )
    return _run_body(retried)


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
            items_failed=run.items_failed,
            items_unanswered=run.items_unanswered,
        ),
        failures=tuple(
            FailureBody(
                data_source=str(failure.data_source),
                candidate=str(failure.candidate),
                attribute=str(failure.attribute),
                error_message=failure.reason,
            )
            for failure in run.failures
        ),
        unanswered=tuple(
            UnansweredBody(candidate=item.candidate, attribute=item.attribute)
            for item in run.unanswered
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
