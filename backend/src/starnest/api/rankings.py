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
from starnest.data import MatchRuleResult, Value
from starnest.evaluation import CandidateResult, rank_candidates
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


class RankingBody(BaseModel):
    criteria_set: str
    level: str
    computed_at: datetime
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
    active = {
        str(candidate.id): await values.read_active_values(candidates=[str(candidate.id)])
        for candidate in roster
    }
    # Both mechanisms that can rule a candidate out, and the rules that only warn (`reqs.md`
    # 5.4). A gate nobody has answered leaves its candidate matching, which is what an
    # unresearched question means.
    answers: dict[str, list[MatchRuleResult]] = {}
    for answer in await match_rule_results.read_results(level=level):
        answers.setdefault(str(answer.candidate), []).append(answer)

    results = rank_candidates(
        criteria=criteria_set_read,
        level=level,
        values=active,
        score_scale_max=settings.score_scale_max,
        min_coverage=settings.min_coverage,
        compound_rules=await catalog.read_compound_rules(level=level),
        gate_answers=answers,
        home_candidate=await _home_country(households),
    )
    return TheRanking(
        criteria=criteria_set_read,
        roster=roster,
        results=results,
        score_scale_max=settings.score_scale_max,
        values=active,
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
        candidates=tuple(_result_body(result, names) for result in _in_rank_order(ranking.results)),
    )


def _in_rank_order(results: tuple[CandidateResult, ...]) -> tuple[CandidateResult, ...]:
    """Ranked candidates first in rank order, then the unscored.

    So a response read straight through is already the dashboard's order, and the unscoreable
    ones sit together at the bottom rather than being scattered by an ordering that has no
    opinion about them.
    """
    return tuple(sorted(results, key=lambda result: (result.rank is None, result.rank or 0)))


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
        name=names.get(str(result.candidate), str(result.candidate)),
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
