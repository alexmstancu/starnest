"""The three lists the interface needs before it can render anything.

Levels for the toggle, criteria sets for the switcher, candidates for the counts beside them --
all read whole rather than paginated, because each is bounded by the catalog (`arch.md` 7.6).
32 countries and eleven pillars do not need a cursor.

**None of them names `country` or `city`.** Levels are ordered records and no code may assume
there are exactly two (`reqs.md` 3.1), so the toggle renders whatever `/levels` returns, in
`depth_order`.
"""

from collections.abc import Sequence
from datetime import timedelta
from typing import ClassVar

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from starnest.api.bodies import ContractBody, PartialChangeBody
from starnest.api.dependencies import Adapters, Candidates, Catalog, Criteria
from starnest.candidates import UnknownCandidateError
from starnest.data import Attribute, DataSource, DataSourceId
from starnest.data_acquisition import SourceAdapter

router = APIRouter(tags=["catalog"])


class LevelBody(BaseModel):
    id: str
    depth_order: int
    parent_level: str | None = None


class HeaviestPillarBody(BaseModel):
    level: str
    pillar: str
    weight: float = Field(ge=0, le=100)


class CriteriaSetSummaryBody(BaseModel):
    id: str
    name: str
    heaviest_pillars: tuple[HeaviestPillarBody, ...]


class CandidateBody(BaseModel):
    id: str
    name: str
    level: str
    parent_candidate: str | None = None
    country_code: str | None = None
    """ISO 3166-1 alpha-2, from the catalog. Null for a candidate that belongs to no country."""


class PillarBody(ContractBody):
    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"description"})

    id: str
    name: str
    description: str | None = None
    display_order: int


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
    answerable_by: tuple[str, ...]


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
    """Headers only, with each set's heaviest pillar per level (PL-040). Reading 41 criteria per
    set to fill a dropdown would make the most frequently rendered element in the product the
    most expensive one."""
    return CriteriaSetsBody(
        items=tuple(
            CriteriaSetSummaryBody(
                id=str(summary.id),
                name=summary.name,
                heaviest_pillars=tuple(
                    HeaviestPillarBody(
                        level=str(heaviest.level),
                        pillar=str(heaviest.pillar),
                        weight=float(heaviest.weight),
                    )
                    for heaviest in summary.heaviest_pillars
                ),
            )
            for summary in await criteria.read_criteria_set_summaries()
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
                country_code=(str(candidate.country_code) if candidate.country_code else None),
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
            PillarBody(
                id=str(pillar.id),
                name=pillar.name,
                description=pillar.description,
                display_order=pillar.display_order,
            )
            for pillar in await catalog.read_pillars()
        )
    )


@router.get("/attributes", operation_id="listAttributes", response_model=AttributesBody)
async def list_attributes(
    catalog: Catalog, adapters: Adapters, level: str | None = None, include_retired: bool = False
) -> AttributesBody:
    """The catalog, with every per-attribute declaration attached.

    Retired attributes are excluded unless asked for: they keep their stored values and drop out
    of scoring, so a caller that wants them has to say so.
    """
    # Read once and resolve each attribute against it: the priority order is the same global
    # order for every attribute, differing only by each one's overrides (`reqs.md` 6.6).
    sources = await catalog.read_data_sources()
    return AttributesBody(
        items=tuple(
            _attribute_body(attribute, sources, adapters)
            for attribute in await catalog.read_attributes(
                level=level, include_retired=include_retired
            )
        )
    )


def _attribute_body(
    attribute: Attribute, sources: Sequence[DataSource], adapters: Sequence[SourceAdapter]
) -> AttributeBody:
    priority = tuple(str(source) for source in attribute.effective_source_priority(sources).ordered)
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
        # The whole resolved order, every source highest first -- not just the overrides (BE-39).
        # An override is partial (`reqs.md` 6.6): the sources it names lead, and every other
        # source keeps its global rank beneath them, which is the order the interface shows.
        effective_source_priority=priority,
        answerable_by=_sources_that_can_fetch(attribute, priority, adapters),
    )


def _sources_that_can_fetch(
    attribute: Attribute, priority: Sequence[str], adapters: Sequence[SourceAdapter]
) -> tuple[str, ...]:
    """The sources with a registered adapter declaring this attribute, in its priority order.

    **Served, not inferred** (`reqs.md` Q235, UI-32). The priority order names every source for
    every attribute, so an interface reading "no source" from it could never say so. Each
    adapter declares what it answers; a source with several is named once, and whether it is
    switched on does not enter into it -- that decides whether it is asked, not what it can do.
    """
    able = {str(adapter.data_source) for adapter in adapters if attribute.id in adapter.attributes}
    return tuple(source for source in priority if source in able)


_DAYS_IN_A_MONTH = 365.25 / 12
"""The mean length of a calendar month, which turns the day count psycopg hands back into months.

psycopg loads an interval's years as 365 days and its months as 30 (SV-N5): `interval '2 years'`
arrives as 730 days, not 730.5, and `interval '60 months'` -- which PostgreSQL holds as five
years -- as 1825. Dividing by this gives 23.98 and 59.96, each within half a month of what was
written, so rounding recovers it. `interval '3 mons'` arrives as 90 days, 2.96 of these, and
rounds to 3. The shortfall grows by a quarter-day a year and under half a day a month, so the
rounding holds for any horizon shorter than forty years.
"""


def _months_of(max_age: timedelta | None) -> int | None:
    """A staleness horizon in whole months, which is the unit the catalog declares.

    Days would be lossy and slightly wrong: two years arrives as 730 of them (known-issues D18).
    The catalog holds only whole months (`reqs.md` 7.1), so rounding recovers exactly what was
    written rather than approximating something continuous.
    """
    if max_age is None:
        return None
    return round(max_age.days / _DAYS_IN_A_MONTH)


class DataSourceBody(BaseModel):
    id: str
    name: str
    source_kind: str
    default_priority: int
    reliability_tier: str
    is_enabled: bool = True


class DataSourceInput(PartialChangeBody):
    """What may be changed about a source: whether it is consulted, and where it stands.

    Both are optional and independent, so switching one off does not have to restate its
    priority. **Nothing here changes what the source measures** -- that is the catalog, and
    the catalog is changed by migration (`reqs.md` 2, Q232). Optional is not nullable: a null
    switch was taken as though it had been left out.
    """

    not_nullable: ClassVar[frozenset[str]] = frozenset({"is_enabled", "default_priority"})

    is_enabled: bool | None = None
    default_priority: int | None = Field(default=None, gt=0)


class DataSourcesBody(BaseModel):
    items: tuple[DataSourceBody, ...]


@router.get("/data-sources", operation_id="listDataSources", response_model=DataSourcesBody)
async def list_data_sources(catalog: Catalog) -> DataSourcesBody:
    """Every source, in the global priority order (`reqs.md` 6.6).

    Reading this list top to bottom is reading the order the active-value rule applies, which is
    what makes a per-attribute override legible: an override names the sources somebody has an
    opinion about, and every other source keeps its place beneath them.
    """
    return _data_sources_body(await catalog.read_data_sources())


def _data_sources_body(sources: Sequence[DataSource]) -> DataSourcesBody:
    return DataSourcesBody(items=tuple(_data_source_body(source) for source in sources))


def _data_source_body(source: DataSource) -> DataSourceBody:
    return DataSourceBody(
        id=str(source.id),
        name=source.name,
        source_kind=str(source.source_kind),
        default_priority=source.default_priority,
        reliability_tier=str(source.reliability_tier),
        is_enabled=source.is_enabled,
    )


class DataSourceOrderInput(BaseModel):
    """Every source, highest priority first: the whole order, never one move (D36)."""

    model_config = ConfigDict(extra="forbid")

    order: tuple[str, ...]


@router.put(
    "/data-sources/order",
    operation_id="reorderDataSources",
    response_model=DataSourcesBody,
)
async def reorder_data_sources(body: DataSourceOrderInput, catalog: Catalog) -> DataSourcesBody:
    """Put the sources in a new order, in one atomic write that keeps their tiers (PL-136, PL-137).

    **The stored priorities are handed back out, not renumbered 1 to n**, so the gaps between
    tiers survive every move; two tied sources are swapped by giving the pair distinct numbers.
    One transaction under a lock, so a move and its undo never stop half way. Refused with
    `invalid_source_order`, changing nothing, unless the order names every source exactly once.
    """
    return _data_sources_body(await catalog.reorder_data_sources(body.order))


@router.patch(
    "/data-sources/{data_source_id}",
    operation_id="updateDataSource",
    response_model=DataSourceBody,
)
async def update_data_source(
    data_source_id: str, body: DataSourceInput, catalog: Catalog
) -> DataSourceBody:
    """Switch a source on or off, and set where it stands in the global order.

    **Switching one off stops it being scored, and keeps every figure it produced**
    (`reqs.md` 3.6): the values stay stored, stay visible in the drill-down with their
    provenance, and come back to the ranking the moment it is switched on again. It also stops
    being asked, so a run does not fetch figures that cannot score.

    **Scores move when this changes**, which is the point rather than a side effect: the
    active-value rule is evaluated on every read, so the next ranking is computed from what is
    still consulted. Nothing is recomputed here and nothing is cached.
    """
    changed = await catalog.set_data_source(
        DataSourceId(data_source_id),
        is_enabled=body.is_enabled,
        default_priority=body.default_priority,
    )
    return _data_source_body(changed)


@router.get("/attributes/{attribute_id}", operation_id="getAttribute", response_model=AttributeBody)
async def get_attribute(attribute_id: str, catalog: Catalog, adapters: Adapters) -> AttributeBody:
    """One attribute with its declarations. Raises a 404 for one the catalog does not hold."""
    attribute = await catalog.read_attribute(attribute_id)
    return _attribute_body(attribute, await catalog.read_data_sources(), adapters)


@router.get("/candidates/{candidate_id}", operation_id="getCandidate", response_model=CandidateBody)
async def get_candidate(candidate_id: str, candidates: Candidates) -> CandidateBody:
    """One candidate. Raises a 404 for one the catalog does not hold."""
    found = next(
        (
            candidate
            for candidate in await candidates.read_candidates()
            if str(candidate.id) == candidate_id
        ),
        None,
    )
    if found is None:
        raise UnknownCandidateError(f"there is no candidate {candidate_id!r}")
    return CandidateBody(
        id=str(found.id),
        name=found.name,
        level=str(found.level.id),
        parent_candidate=str(found.parent_candidate) if found.parent_candidate else None,
        country_code=str(found.country_code) if found.country_code else None,
    )
