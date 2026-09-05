"""The three lists the interface needs before it can render anything.

Levels for the toggle, criteria sets for the switcher, candidates for the counts beside them --
all read whole rather than paginated, because each is bounded by the catalog (`arch.md` 7.6).
32 countries and eleven pillars do not need a cursor.

**None of them names `country` or `city`.** Levels are ordered records and no code may assume
there are exactly two (`reqs.md` 3.1), so the toggle renders whatever `/levels` returns, in
`depth_order`.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.dependencies import Candidates, Catalog, Criteria

router = APIRouter(tags=["catalog"])


class LevelBody(BaseModel):
    id: str
    depth_order: int
    parent_level: str | None = None


class CriteriaSetSummaryBody(BaseModel):
    id: str
    name: str


class CandidateBody(BaseModel):
    id: str
    name: str
    level: str
    parent_candidate: str | None = None


class LevelsBody(BaseModel):
    items: tuple[LevelBody, ...]


class CriteriaSetsBody(BaseModel):
    items: tuple[CriteriaSetSummaryBody, ...]


class CandidatesBody(BaseModel):
    items: tuple[CandidateBody, ...]


@router.get("/levels", operation_id="listLevels", response_model=LevelsBody)
async def list_levels(catalog: Catalog) -> LevelsBody:
    """In `depth_order`, which is what tells a caller which level screens first."""
    hierarchy = await catalog.read_levels()
    return LevelsBody(
        items=tuple(
            LevelBody(
                id=str(level.id),
                depth_order=level.depth_order,
                parent_level=str(level.parent_level) if level.parent_level else None,
            )
            for level in hierarchy.ordered
        )
    )


@router.get("/criteria-sets", operation_id="listCriteriaSets", response_model=CriteriaSetsBody)
async def list_criteria_sets(criteria: Criteria) -> CriteriaSetsBody:
    """Headers only. Reading 41 criteria per set to fill a dropdown would make the most
    frequently rendered element in the product the most expensive one."""
    return CriteriaSetsBody(
        items=tuple(
            CriteriaSetSummaryBody(id=str(identifier), name=name)
            for identifier, name in await criteria.read_criteria_set_summaries()
        )
    )


@router.get("/candidates", operation_id="listCandidates", response_model=CandidatesBody)
async def list_candidates(
    candidates: Candidates, level: str | None = None, parent: str | None = None
) -> CandidatesBody:
    """Every candidate, or every candidate at one level.

    `parent` is in the contract for the city level and is accepted rather than ignored: a filter
    silently dropped would return every country to a caller that asked for one country's cities.
    """
    roster = await candidates.read_candidates(level=level)
    if parent is not None:
        roster = tuple(
            candidate for candidate in roster if str(candidate.parent_candidate or "") == parent
        )
    return CandidatesBody(
        items=tuple(
            CandidateBody(
                id=str(candidate.id),
                name=candidate.name,
                level=str(candidate.level.id),
                parent_candidate=(
                    str(candidate.parent_candidate) if candidate.parent_candidate else None
                ),
            )
            for candidate in roster
        )
    )
