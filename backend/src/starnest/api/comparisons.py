"""A focus candidate against its comparators (`reqs.md` 8.5).

**Always live**: computed from the same ranking `GET /rankings` computes, so a weight change
shows up here the moment it shows up there. Nothing is stored; freezing a comparison is the
post-MVP "saved comparisons", where the freezing is the point.

**The comparator limit is a setting**, refused rather than defaulted when unset, for the reason
the score scale is: a bound nobody chose is a bound this application invented.
"""

from collections.abc import Mapping, Sequence
from typing import Annotated, ClassVar

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import (
    Candidates,
    Catalog,
    Criteria,
    Households,
    MatchRuleResults,
    Values,
)
from starnest.api.rankings import CandidateResultBody, _result_body, evidence_for, the_ranking
from starnest.api.values import ValueBody, _value_body
from starnest.comparison import (
    AttributeComparison,
    ComparatorCell,
    Synthesis,
    SynthesisLine,
    compare,
)
from starnest.data import Value, ValueListing
from starnest.evaluation.magnitudes import PublishedFigure, UnscoreableValueError, figure_of

router = APIRouter(tags=["evaluation"])


class ComparisonSideBody(ContractBody):
    """One side of one row. **`value` is omitted, never null, when that side has no figure**:
    the design types it as an object and leaves it optional, and null would be a different
    claim (`api/bodies.py`)."""

    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"value"})

    value: ValueBody | None = None
    normalised_score: int | None = None


class ComparatorCellBody(ComparisonSideBody):
    candidate: str
    delta: float | None = None
    weighted_contribution: float | None = None


class ComparisonAttributeRowBody(BaseModel):
    attribute: str
    pillar: str
    effective_weight: float
    focus: ComparisonSideBody
    comparators: tuple[ComparatorCellBody, ...]


class SynthesisLineBody(BaseModel):
    pillar: str
    worth: float


class SynthesisBody(BaseModel):
    comparator: str
    score_delta: int | None = None
    advantages: tuple[str, ...] = ()
    disadvantages: tuple[str, ...] = ()
    ahead: tuple[SynthesisLineBody, ...]
    behind: tuple[SynthesisLineBody, ...]
    not_comparable: tuple[str, ...]


class ComparisonBody(BaseModel):
    criteria_set: str
    level: str
    score_scale_max: int = Field(
        description="The top of the range both sides' scores are on: always the live setting."
    )
    focus: CandidateResultBody
    comparators: tuple[CandidateResultBody, ...]
    attributes: tuple[ComparisonAttributeRowBody, ...]
    synthesis: tuple[SynthesisBody, ...] = ()


@router.get("/comparisons", operation_id="getComparison", response_model=ComparisonBody)
async def get_comparison(
    criteria_set: str,
    level: str,
    focus: str,
    criteria: Criteria,
    candidates: Candidates,
    values: Values,
    households: Households,
    catalog: Catalog,
    match_rule_results: MatchRuleResults,
    comparators: Annotated[list[str], Query()] = [],  # noqa: B006  (FastAPI reads the default)
) -> ComparisonBody:
    """The focus against each comparator, attribute by attribute, with the synthesis.

    **Every gap and every worth reads comparator minus focus**: positive where the comparator is
    ahead, as the matrix draws it, and a pair's advantages are what the comparator leads on.

    A candidate at another level is simply not in this level's ranking and is refused by name,
    which is how "comparisons never mix levels" enforces itself rather than being remembered.
    """
    ranking = await the_ranking(
        criteria_set, level, criteria, candidates, values, households, catalog, match_rule_results
    )
    settings = await households.get_settings()
    if settings.comparator_limit is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "comparator_limit_not_set",
                "message": (
                    "comparator_limit is not set, so there is no bound on how many comparators "
                    "a comparison may hold. Set it in Settings; it is provisional by design and "
                    "has no default."
                ),
            },
        )

    figures = _magnitudes(ranking.values)
    drawn = compare(
        results=ranking.results,
        focus=focus,
        comparators=comparators,
        magnitudes=figures,
        # The catalog's display names, so a synthesis line reads "Total tax rate" rather than
        # an identifier. Names are catalog data and are never restated in this module.
        names={str(a.id): a.name for a in await catalog.read_attributes(level=level)},
        comparator_limit=settings.comparator_limit,
    )
    names = {str(candidate.id): candidate.name for candidate in ranking.roster}
    active = _active_values(ranking.values)
    stale = ranking.stale_values
    evidence = await evidence_for((drawn.focus, *drawn.comparators), values)
    return ComparisonBody(
        criteria_set=criteria_set,
        level=level,
        score_scale_max=ranking.score_scale_max,
        focus=_result_body(drawn.focus, names, evidence),
        comparators=tuple(_result_body(result, names, evidence) for result in drawn.comparators),
        attributes=tuple(
            _row_body(row, str(drawn.focus.candidate), active, stale) for row in drawn.attributes
        ),
        synthesis=tuple(_synthesis_body(pair) for pair in drawn.synthesis),
    )


def _magnitudes(values: Mapping[str, Sequence[Value]]) -> dict[str, dict[str, PublishedFigure]]:
    """Each candidate's comparable figure per attribute, in the attribute's own unit -- in EUR for
    a Monetary attribute, the figure both sides are read as (`magnitudes.py`, `reqs.md` 5.5) --
    with the scale it declares, so no gap is taken across two scales (C06-S2)."""
    figures: dict[str, dict[str, PublishedFigure]] = {}
    for candidate, stored in values.items():
        for value in stored:
            try:
                figures.setdefault(candidate, {})[str(value.attribute)] = figure_of(value)
            except UnscoreableValueError:
                continue
    return figures


def _active_values(values: Mapping[str, Sequence[Value]]) -> dict[str, dict[str, Value]]:
    """The value behind each side's figure, for the provenance the table shows beside it."""
    return {
        candidate: {str(value.attribute): value for value in stored}
        for candidate, stored in values.items()
    }


def _row_body(
    row: AttributeComparison,
    focus: str,
    active: dict[str, dict[str, Value]],
    stale: frozenset[int],
) -> ComparisonAttributeRowBody:
    return ComparisonAttributeRowBody(
        attribute=str(row.attribute),
        pillar=str(row.pillar),
        effective_weight=float(row.focus_effective_weight),
        focus=ComparisonSideBody(
            value=_side_value(active, focus, str(row.attribute), stale),
            normalised_score=row.focus_score,
        ),
        comparators=tuple(
            _cell_body(cell, str(row.attribute), active, stale) for cell in row.comparators
        ),
    )


def _cell_body(
    cell: ComparatorCell,
    attribute: str,
    active: dict[str, dict[str, Value]],
    stale: frozenset[int],
) -> ComparatorCellBody:
    return ComparatorCellBody(
        candidate=str(cell.candidate),
        value=_side_value(active, str(cell.candidate), attribute, stale),
        normalised_score=cell.normalised_score,
        delta=None if cell.delta is None else float(cell.delta),
        weighted_contribution=(
            None if cell.weighted_contribution is None else float(cell.weighted_contribution)
        ),
    )


def _side_value(
    active: dict[str, dict[str, Value]], candidate: str, attribute: str, stale: frozenset[int]
) -> ValueBody | None:
    """The figure this side holds, with its provenance -- the active one, hence `is_active`.

    Its freshness is the one the ranking graded it by, from the same read (PL-069). Its source is
    on, because the active-value view never chooses a figure from a switched-off source.
    """
    value = active.get(candidate, {}).get(attribute)
    if value is None:
        return None
    return _value_body(
        ValueListing(
            value=value,
            is_active=True,
            is_fresh=value.id not in stale,
            source_is_enabled=True,
        )
    )


def _synthesis_body(pair: Synthesis) -> SynthesisBody:
    return SynthesisBody(
        comparator=str(pair.comparator),
        score_delta=pair.score_delta,
        advantages=pair.advantages,
        disadvantages=pair.disadvantages,
        ahead=tuple(_line_body(line) for line in pair.ahead),
        behind=tuple(_line_body(line) for line in pair.behind),
        not_comparable=tuple(str(pillar) for pillar in pair.not_comparable),
    )


def _line_body(line: SynthesisLine) -> SynthesisLineBody:
    return SynthesisLineBody(pillar=str(line.pillar), worth=float(line.worth))
