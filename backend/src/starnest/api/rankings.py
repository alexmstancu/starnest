"""`GET /v1/rankings` -- the payoff.

Every candidate at one level, scored by one criteria set, in order. Computed live rather than
read from a saved evaluation: adjusting a weight recalculates from stored values and never
re-fetches (`reqs.md` 5.6), and a saved evaluation is written only when deliberately kept
(`reqs.md` Q155). Nothing is stored by this endpoint.

**Non-matching and unscoreable candidates are returned.** They are never filtered out here and
must not be filtered downstream: the reason a candidate is out is a thing this product exists to
show (`reqs.md` 5.4). A candidate with no data comes back with a null score, its coverage, and
the sentence saying why.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from starnest.api.dependencies import (
    Candidates,
    Catalog,
    Criteria,
    Households,
    MatchRuleResults,
    Values,
)
from starnest.candidates import Candidate
from starnest.criteria import CriteriaSet
from starnest.data import Attribute, MatchRule, MatchRuleResult, Value, ValueType
from starnest.evaluation import (
    AttributeScore,
    CandidateResult,
    declared_weights,
    in_display_order,
    rank_candidates,
)
from starnest.evaluation.wording import Names, readable_identifier, unit_words
from starnest.household import HouseholdNotConfiguredError

router = APIRouter(tags=["rankings"])


class ConfidenceSplitBody(BaseModel):
    """Percentages of the covered weight, summing to 100 (`reqs.md` 5.7)."""

    absolute: float
    high: float
    medium: float
    low: float


class WarningBody(BaseModel):
    compound_rule: str
    detail: str


class NonMatchReasonBody(BaseModel):
    """Exactly one of the three names the rule that said so (`reqs.md` 5.4)."""

    reason_detail: str
    criterion: str | None = None
    match_rule: str | None = None
    compound_rule: str | None = None


class PillarScoreBody(BaseModel):
    """One pillar's part in a candidate's total (`reqs.md` 5.2)."""

    pillar: str
    score: int | None = Field(default=None, description="Null when nothing in it scored.")
    weight: float = Field(description="Its share of the level after redistribution.")
    contribution: float


class CandidateResultBody(BaseModel):
    candidate: str
    name: str
    rank: int | None = None
    score: int | None = Field(
        default=None, description="Null only when insufficient data. On the evaluation's scale."
    )
    coverage: float
    coverage_by_confidence: ConfidenceSplitBody | None = Field(
        default=None,
        description="How the covered weight splits by confidence. Null when nothing is covered.",
    )
    pillar_scores: tuple[PillarScoreBody, ...] = ()
    delta_vs_home: float | None = Field(
        default=None,
        description=(
            "This candidate's score minus the home country's. Null for home itself, and null "
            "when either score is absent."
        ),
    )
    match_status: str
    insufficient_reason: str | None = None
    warnings: tuple[WarningBody, ...] = ()
    non_match_reasons: tuple[NonMatchReasonBody, ...] = ()


class AttributeScoreBody(BaseModel):
    attribute: str
    pillar: str
    normalised_score: int | None = None
    weight: float = Field(
        description=(
            "Its share of the level as configured, after exclusions and before redistribution: "
            "the same basis as effective_weight (PL-063)."
        ),
    )
    effective_weight: float
    contribution: float


ScoreScaleMax = Annotated[
    int,
    Field(
        description=(
            "The top of the range every score here is on: the setting when a live result was "
            "computed, the frozen value for a saved one -- never the current setting for that."
        ),
    ),
]


class CandidateScoreDetailBody(CandidateResultBody):
    """Why a candidate scored what it scored, attribute by attribute.

    **Here rather than beside the saved evaluations**, because a live ranking answers the same
    question and `api/evaluations.py` already depends on this module. The two paths must return
    the same shape: a drill-down that looked different depending on whether the ranking had
    been saved would be two answers to one question.
    """

    score_scale_max: ScoreScaleMax
    attribute_scores: tuple[AttributeScoreBody, ...] = ()


class RankingBody(BaseModel):
    criteria_set: str
    level: str
    computed_at: datetime
    score_scale_max: ScoreScaleMax
    candidates: tuple[CandidateResultBody, ...]


@dataclass(frozen=True)
class TheRanking:
    """One ranking and the inputs behind it, so a caller needing more than the table has them.

    `POST /evaluations` keeps the criteria and results; `GET /comparisons` also needs the values,
    because a comparison shows each side's figure in the attribute's own unit beside the scores.
    Recomputing either separately would be a second code path that could disagree with this one.
    """

    criteria: CriteriaSet
    roster: tuple[Candidate, ...]
    results: tuple[CandidateResult, ...]
    score_scale_max: int
    values: Mapping[str, Sequence[Value]]
    stale_values: frozenset[int]


async def the_ranking(
    criteria_set: str,
    level: str,
    criteria: Criteria,
    candidates: Candidates,
    values: Values,
    households: Households,
    catalog: Catalog,
    match_rule_results: MatchRuleResults,
) -> "TheRanking":
    """Score every candidate at this level, and hand back everything it took to do it.

    Shared with `POST /evaluations`, which keeps what this computes. Two code paths would mean a
    saved evaluation could differ from the ranking it was saved from, in ways nothing would show.

    **The named resource is read first.** Asked for a ranking of a criteria set that does not
    exist, this used to answer "score_scale_max is not set" -- true, and not the reason the
    request failed. A 404 is about the request; a 409 is about state, and a client told the
    second when the first applies goes and changes a setting that was never the problem.
    """
    criteria_set_read = await criteria.read_criteria_set(criteria_set, level=level)

    settings = await households.get_settings()
    if settings.score_scale_max is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "score_scale_not_set",
                "message": (
                    "score_scale_max is not set, so there is no scale to score onto. Set it in "
                    "Settings; it is provisional by design and has no default."
                ),
            },
        )

    roster = await candidates.read_candidates(level=level)
    # **One read for the level, in one snapshot** (PL-065), and the stale ids from the same rows
    # (PL-064): the flag that lowers a figure's grade in the confidence split is the flag the
    # active-value view chose it by. Built from the roster rather than from the values, so a
    # candidate with no figure at all stays in the ranking as `insufficient_data` (`reqs.md` 5.4).
    read = await values.read_active_values_with_freshness(level=level)
    grouped: dict[str, list[Value]] = {}
    for each in read:
        grouped.setdefault(str(each.value.candidate), []).append(each.value)
    active = {str(candidate.id): tuple(grouped.get(str(candidate.id), ())) for candidate in roster}
    stale_values = frozenset(
        each.value.id for each in read if not each.is_fresh and each.value.id is not None
    )
    # Both mechanisms that can rule a candidate out, and the rules that only warn (`reqs.md`
    # 5.4). A gate nobody has answered leaves its candidate matching, which is what an
    # unresearched question means.
    answers: dict[str, list[MatchRuleResult]] = {}
    for answer in await match_rule_results.read_results(level=level):
        answers.setdefault(str(answer.candidate), []).append(answer)

    # What the catalog calls each attribute and gate, for the sentences a result carries.
    attributes = await catalog.read_attributes(level=level)
    results = rank_candidates(
        criteria=criteria_set_read,
        level=level,
        values=active,
        score_scale_max=settings.score_scale_max,
        min_coverage=settings.min_coverage,
        compound_rules=await catalog.read_compound_rules(level=level),
        gate_answers=answers,
        home_candidate=await _home_country(households),
        names=names_in(attributes, await catalog.read_match_rules(level=level)),
        stale_values=stale_values,
    )
    return TheRanking(
        criteria=criteria_set_read,
        roster=roster,
        results=results,
        score_scale_max=settings.score_scale_max,
        values=active,
        stale_values=stale_values,
    )


@router.get("/rankings", operation_id="getRanking", response_model=RankingBody)
async def get_ranking(
    criteria_set: str,
    level: str,
    criteria: Criteria,
    candidates: Candidates,
    values: Values,
    households: Households,
    catalog: Catalog,
    match_rule_results: MatchRuleResults,
) -> RankingBody:
    """Score every candidate at this level and return them in rank order.

    **Computes and returns; stores nothing** (`reqs.md` 5.6, Q155). Adjusting a weight
    recalculates from stored values, and an afternoon of tuning must not bury the few results
    worth keeping under hundreds nobody asked for. `POST /evaluations` is how one is kept.
    """
    ranking = await the_ranking(
        criteria_set, level, criteria, candidates, values, households, catalog, match_rule_results
    )
    names = {str(candidate.id): candidate.name for candidate in ranking.roster}
    return RankingBody(
        criteria_set=criteria_set,
        level=level,
        computed_at=datetime.now(UTC),
        score_scale_max=ranking.score_scale_max,
        candidates=tuple(
            _result_body(result, names) for result in in_display_order(ranking.results)
        ),
    )


@router.get(
    "/rankings/candidates/{candidate_id}",
    operation_id="getRankedCandidateDetail",
    response_model=CandidateScoreDetailBody,
)
async def get_ranked_candidate_detail(
    candidate_id: str,
    criteria_set: str,
    level: str,
    criteria: Criteria,
    candidates: Candidates,
    values: Values,
    households: Households,
    catalog: Catalog,
    match_rule_results: MatchRuleResults,
) -> CandidateScoreDetailBody:
    """The drill-down for a ranking nobody saved.

    **The same question `getCandidateScoreDetail` answers, asked of the live set.** That one
    takes an evaluation id, and a ranking computed on the fly has none -- so the numbers behind
    a score on screen could be reached only by saving the ranking first, which is a decision
    about what to keep rather than a step in reading it.

    **Computes and returns; stores nothing**, like the ranking it drills into. It runs the whole
    level rather than one candidate because redistribution and the score scale are properties of
    the pass, not of the row: scoring one candidate alone would give a different answer.
    """
    ranking = await the_ranking(
        criteria_set, level, criteria, candidates, values, households, catalog, match_rule_results
    )
    result = next((each for each in ranking.results if str(each.candidate) == candidate_id), None)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "candidate_not_found",
                "message": (
                    f"no candidate called {candidate_id!r} was ranked at level {level!r}; it may "
                    f"belong to another level or not exist"
                ),
            },
        )
    names = {str(candidate.id): candidate.name for candidate in ranking.roster}
    weights = declared_weights(ranking.criteria, level)
    return CandidateScoreDetailBody(
        **_result_body(result, names).model_dump(),
        score_scale_max=ranking.score_scale_max,
        attribute_scores=tuple(
            _attribute_score_body(row, weights) for row in result.attribute_scores
        ),
    )


def _attribute_score_body(
    row: AttributeScore, declared: Mapping[str, Decimal]
) -> AttributeScoreBody:
    """One row of a drill-down, its two weights on one basis (PL-063, D21).

    `declared` comes from the criteria the pass was scored by -- the live set for a live
    ranking, the frozen snapshot for a saved one -- so the two paths answer alike.
    """
    return AttributeScoreBody(
        attribute=str(row.attribute),
        pillar=str(row.pillar),
        normalised_score=row.normalised_score,
        weight=float(declared[str(row.attribute)]),
        effective_weight=float(row.effective_weight),
        contribution=float(row.contribution),
    )


def names_in(attributes: Sequence[Attribute], gates: Sequence[MatchRule]) -> Names:
    """What the catalog calls each attribute, its unit and each gate, for the sentences a
    result carries (PL-067). A ratio is a percentage; a quantity reads its unit's name."""
    units: dict[str, str] = {}
    for attribute in attributes:
        if attribute.value_type is ValueType.RATIO:
            units[str(attribute.id)] = "%"
        elif attribute.quantity_parameters and attribute.quantity_parameters.unit_name:
            units[str(attribute.id)] = unit_words(attribute.quantity_parameters.unit_name)
    return Names(
        attributes={str(attribute.id): attribute.name for attribute in attributes},
        units=units,
        gates={str(gate.id): gate.name for gate in gates},
    )


async def _home_country(households: Households) -> str | None:
    """The household's own country, or None when no household has been recorded.

    **A ranking must not 404 for want of a household.** Reading one raises when nothing has been
    configured, and the home country is only ever the anchor of one column: without it the
    difference is null everywhere and the other nine columns are unaffected. Refusing the whole
    ranking over an optional column would be the tail wagging the dog.
    """
    try:
        household = await households.get_household()
    except HouseholdNotConfiguredError:
        return None
    return str(household.home_country_candidate)


def _result_body(result: CandidateResult, names: dict[str, str]) -> CandidateResultBody:
    return CandidateResultBody(
        candidate=str(result.candidate),
        name=names.get(str(result.candidate)) or readable_identifier(str(result.candidate)),
        rank=result.rank,
        score=result.score,
        coverage=result.coverage,
        coverage_by_confidence=(
            ConfidenceSplitBody(**{str(grade): share for grade, share in split.items()})
            if (split := result.coverage_by_confidence)
            else None
        ),
        pillar_scores=tuple(
            PillarScoreBody(
                pillar=str(pillar.pillar),
                score=pillar.score,
                weight=pillar.weight,
                contribution=pillar.contribution,
            )
            for pillar in result.pillar_scores
        ),
        delta_vs_home=result.delta_vs_home,
        match_status=str(result.match_status),
        insufficient_reason=result.insufficient_reason,
        warnings=tuple(
            WarningBody(compound_rule=str(flag.compound_rule), detail=flag.detail)
            for flag in result.warnings
        ),
        non_match_reasons=tuple(
            NonMatchReasonBody(
                reason_detail=reason.reason_detail,
                criterion=None if reason.criterion is None else str(reason.criterion),
                match_rule=None if reason.match_rule is None else str(reason.match_rule),
                compound_rule=(None if reason.compound_rule is None else str(reason.compound_rule)),
            )
            for reason in result.non_match_reasons
        ),
    )
