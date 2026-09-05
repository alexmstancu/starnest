"""The three lists the interface needs before it can render anything.

Levels for the toggle, criteria sets for the switcher, candidates for the counts beside them --
all read whole rather than paginated, because each is bounded by the catalog (`arch.md` 7.6).
32 countries and eleven pillars do not need a cursor.

**None of them names `country` or `city`.** Levels are ordered records and no code may assume
there are exactly two (`reqs.md` 3.1), so the toggle renders whatever `/levels` returns, in
`depth_order`.
"""

from datetime import timedelta
from typing import ClassVar

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import Candidates, Catalog, Criteria
from starnest.data import Attribute

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


class PillarBody(ContractBody):
    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"description"})

    id: str
    name: str
    description: str | None = None


class AllowedRangeBody(BaseModel):
    min_value: float | None = None
    max_value: float | None = None


class AttributeBody(ContractBody):
    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"description"})
    """Every other optional field here is typed `[x, "null"]` in the design, so null is exactly
    what those mean."""

    id: str
    name: str
    level: str
    value_type: str
    description: str | None = None
    pillar: str | None = None
    unit: str | None = None
    max_age_months: int | None = None
    manual_entry: bool = False
    breakdown_scheme: str | None = None
    breakdown_options: tuple[str, ...] = ()
    allowed_range: AllowedRangeBody | None = None
    allowed_labels: tuple[str, ...] = ()
    effective_source_priority: tuple[str, ...] = ()


class PillarsBody(BaseModel):
    items: tuple[PillarBody, ...]


class AttributesBody(BaseModel):
    items: tuple[AttributeBody, ...]


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


@router.get("/pillars", operation_id="listPillars", response_model=PillarsBody)
async def list_pillars(catalog: Catalog) -> PillarsBody:
    """The eleven load-bearing verticals of a life (`reqs.md` 3.3).

    Returned whole: eleven rows bounded by the catalog need no cursor (`arch.md` 7.6).
    """
    return PillarsBody(
        items=tuple(
            PillarBody(id=str(pillar.id), name=pillar.name, description=pillar.description)
            for pillar in await catalog.read_pillars()
        )
    )


@router.get("/attributes", operation_id="listAttributes", response_model=AttributesBody)
async def list_attributes(
    catalog: Catalog, level: str | None = None, include_retired: bool = False
) -> AttributesBody:
    """The catalog, with every per-attribute declaration attached.

    Retired attributes are excluded unless asked for: they keep their stored values and drop out
    of scoring, so a caller that wants them has to say so.
    """
    return AttributesBody(
        items=tuple(
            _attribute_body(attribute)
            for attribute in await catalog.read_attributes(
                level=level, include_retired=include_retired
            )
        )
    )


def _attribute_body(attribute: Attribute) -> AttributeBody:
    return AttributeBody(
        id=str(attribute.id),
        name=attribute.name,
        level=str(attribute.level),
        value_type=str(attribute.value_type),
        description=attribute.description,
        pillar=str(attribute.pillar) if attribute.pillar else None,
        unit=(str(attribute.quantity_parameters.unit) if attribute.quantity_parameters else None),
        max_age_months=_months_of(attribute.max_age),
        manual_entry=attribute.manual_entry,
        breakdown_scheme=(str(attribute.breakdown_scheme) if attribute.breakdown_scheme else None),
        allowed_range=(
            AllowedRangeBody(
                min_value=(
                    float(attribute.allowed_range.min_value)
                    if attribute.allowed_range.min_value is not None
                    else None
                ),
                max_value=(
                    float(attribute.allowed_range.max_value)
                    if attribute.allowed_range.max_value is not None
                    else None
                ),
            )
            if attribute.allowed_range
            else None
        ),
        allowed_labels=attribute.allowed_labels,
        effective_source_priority=tuple(
            str(override.data_source) for override in attribute.source_priority_overrides
        ),
    )


_DAYS_IN_A_MONTH = 365.25 / 12
"""What PostgreSQL's own epoch arithmetic implies: a year is 365.25 days, so a month is this.

`interval '2 years'` comes back as 730.5 days and `interval '24 months'` means the same thing;
dividing by this recovers 24 exactly. `interval '3 mons'` is the one inexact case -- PostgreSQL
gives it 90 days flat, which is 2.96 of these -- and it rounds to 3, which is what it means.
"""


def _months_of(max_age: timedelta | None) -> int | None:
    """A staleness horizon in whole months, which is the unit the catalog declares.

    Days would be lossy and slightly wrong: two years is 730.5 of them (known-issues D18). The
    catalog holds only whole months (`reqs.md` 7.1), so rounding recovers exactly what was
    written rather than approximating something continuous.
    """
    if max_age is None:
        return None
    return round(max_age.days / _DAYS_IN_A_MONTH)
