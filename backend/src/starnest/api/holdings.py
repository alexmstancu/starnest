"""What the database holds at a level, and what this month has cost (PL-051, PL-052, PL-054).

The run read is one run's accounting; this is the database's. The two are kept apart so that
opening, dismissing or retrying a run never changes what the database is said to hold.
"""

from datetime import datetime

from fastapi import APIRouter
from pydantic import AwareDatetime, BaseModel

from starnest.api.dependencies import Adapters, Catalog, Households, Runs
from starnest.api.errors import unknown_scope_refusal
from starnest.data_acquisition import Gap, Holdings, stand_ins_if_enabled, switched_on

router = APIRouter(tags=["acquisition"])


class SpentBody(BaseModel):
    since: datetime
    runs_eur: float
    research_eur: float
    total_eur: float


class GapFailureBody(BaseModel):
    data_source: str
    error_message: str


class FailedGapBody(BaseModel):
    candidate: str
    attribute: str
    data_acquisition_run: int
    failures: tuple[GapFailureBody, ...]


class UnansweredGapBody(BaseModel):
    candidate: str
    attribute: str
    data_acquisition_run: int


class NotReachedGapBody(BaseModel):
    candidate: str
    attribute: str
    data_acquisition_run: int | None


class GapsBody(BaseModel):
    failed: tuple[FailedGapBody, ...]
    unanswered: tuple[UnansweredGapBody, ...]
    not_reached: tuple[NotReachedGapBody, ...]


class HoldingsBody(BaseModel):
    level: str
    pairs_total: int
    values_stored: int
    values_past_allowed_age: int
    values_older_than_refetch_age: int | None
    spent: SpentBody
    gaps: GapsBody


@router.get("/holdings", operation_id="getHoldings", response_model=HoldingsBody)
async def get_holdings(
    level: str,
    since: AwareDatetime,
    adapters: Adapters,
    catalog: Catalog,
    runs: Runs,
    households: Households,
) -> HoldingsBody:
    """The database at a level, read in one statement so its figures add up.

    **`since` must carry its zone**: it is the reader's month start (C04-N10), and a time
    without one would be read on the database's clock, the decision this parameter keeps off the
    server. The askable attributes are what the switched-on adapters declare -- the facts
    `answerable_by` serves (Q235) -- because the database does not hold them.
    """
    if level not in await catalog.read_levels():
        raise unknown_scope_refusal(level, unknown_levels=[level])
    sources = await catalog.read_data_sources()
    askable = {str(a) for adapter in switched_on(adapters, sources) for a in adapter.attributes}
    lent = stand_ins_if_enabled(await catalog.read_stand_ins(level=level), sources)
    holdings = await runs.read_holdings(
        level=level,
        askable_attributes=sorted(askable),
        stand_in_pairs=[(str(each.candidate), str(each.attribute)) for each in lent],
        since=since,
        refetch_older_than_days=(await households.get_settings()).refetch_older_than_days,
    )
    return _holdings_body(holdings)


def _holdings_body(holdings: Holdings) -> HoldingsBody:
    spent = holdings.spent
    return HoldingsBody(
        level=holdings.level,
        pairs_total=holdings.pairs_total,
        values_stored=holdings.values_stored,
        values_past_allowed_age=holdings.values_past_allowed_age,
        values_older_than_refetch_age=holdings.values_older_than_refetch_age,
        spent=SpentBody(
            since=spent.since,
            runs_eur=float(spent.runs_eur),
            research_eur=float(spent.research_eur),
            total_eur=float(spent.total_eur),
        ),
        gaps=GapsBody(
            failed=tuple(_failed(gap) for gap in holdings.failed),
            unanswered=tuple(
                UnansweredGapBody(
                    candidate=gap.candidate,
                    attribute=gap.attribute,
                    data_acquisition_run=gap.data_acquisition_run,
                )
                for gap in holdings.unanswered
            ),
            not_reached=tuple(
                NotReachedGapBody(
                    candidate=gap.candidate,
                    attribute=gap.attribute,
                    data_acquisition_run=gap.data_acquisition_run,
                )
                for gap in holdings.not_reached
            ),
        ),
    )


def _failed(gap: Gap) -> FailedGapBody:
    return FailedGapBody(
        candidate=gap.candidate,
        attribute=gap.attribute,
        data_acquisition_run=gap.data_acquisition_run,
        failures=tuple(
            GapFailureBody(data_source=str(failure.data_source), error_message=failure.reason)
            for failure in gap.failures
        ),
    )
