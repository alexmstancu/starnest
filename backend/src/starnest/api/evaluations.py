"""Keeping a ranking, and reading back exactly what was kept (`reqs.md` 3.4a, Q155, Q156).

`GET /rankings` computes and stores nothing; this is where a result is deliberately kept, **with
a frozen copy of the criteria that produced it**. The criteria set stays editable afterwards, so
without the snapshot a saved evaluation would change meaning the next time a weight moved.

The drill-down here is the provenance chain end to end: a total, the attributes behind it, each
one's effective weight after redistribution, and the exact stored value it was computed from.
"""

from collections.abc import Mapping
from datetime import UTC, datetime

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict

from starnest.api.criteria import CriterionBody, _criterion_body
from starnest.api.dependencies import (
    Candidates,
    Catalog,
    Criteria,
    Evaluations,
    Households,
    MatchRuleResults,
    Values,
)
from starnest.api.rankings import (
    CandidateScoreDetailBody,
    RankingBody,
    _home_country,
    _result_body,
    evidence_for,
    score_detail_body,
    the_ranking,
)
from starnest.evaluation import (
    CandidateResult,
    SavedEvaluation,
    UnknownEvaluationError,
    against_home,
    declared_weights,
    in_display_order,
)
from starnest.evaluation.wording import readable_identifier

router = APIRouter(tags=["evaluation"])


class LeaderBody(BaseModel):
    candidate: str
    name: str


class EvaluationSummaryBody(BaseModel):
    id: int
    criteria_set: str
    level: str
    computed_at: datetime
    score_scale_max: int
    note: str | None = None
    leader: LeaderBody | None = None


class EvaluationsBody(BaseModel):
    items: tuple[EvaluationSummaryBody, ...]


class SaveEvaluationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criteria_set: str
    level: str
    note: str | None = None


class EvaluationPillarWeightBody(BaseModel):
    """The contract's `PillarWeight`, which names no level: the evaluation's header already
    says which level it ran at, and an evaluation never spans two (`reqs.md` 3.4a)."""

    pillar: str
    weight: float
    weight_locked: bool


class EvaluationCriteriaBody(BaseModel):
    pillar_weights: tuple[EvaluationPillarWeightBody, ...]
    criteria: tuple[CriterionBody, ...]


@router.get("/evaluations", operation_id="listEvaluations", response_model=EvaluationsBody)
async def list_evaluations(evaluations: Evaluations, candidates: Candidates) -> EvaluationsBody:
    """The kept results, newest first, each naming who led it (PL-145)."""
    names = await _roster_names(candidates)
    return EvaluationsBody(
        items=tuple(_summary(saved, names) for saved in await evaluations.read_evaluations())
    )


@router.post(
    "/evaluations",
    operation_id="saveEvaluation",
    status_code=201,
    response_model=EvaluationSummaryBody,
)
async def save_evaluation(
    body: SaveEvaluationBody,
    evaluations: Evaluations,
    criteria: Criteria,
    candidates: Candidates,
    values: Values,
    households: Households,
    catalog: Catalog,
    match_rule_results: MatchRuleResults,
) -> EvaluationSummaryBody:
    """Compute the ranking and keep it, with the criteria snapshot behind it.

    The same computation `GET /rankings` performs, called rather than repeated: two code paths
    would let a saved evaluation differ from the ranking it was saved from.
    """
    ranking = await the_ranking(
        body.criteria_set,
        body.level,
        criteria,
        candidates,
        values,
        households,
        catalog,
        match_rule_results,
    )
    saved = await evaluations.save(
        criteria=ranking.criteria,
        level=body.level,
        results=ranking.results,
        score_scale_max=ranking.score_scale_max,
        computed_at=datetime.now(UTC),
        note=body.note,
    )
    return _summary(saved, {str(candidate.id): candidate.name for candidate in ranking.roster})


@router.get(
    "/evaluations/{evaluation_id}", operation_id="getEvaluation", response_model=RankingBody
)
async def get_evaluation(
    evaluation_id: int,
    evaluations: Evaluations,
    candidates: Candidates,
    values: Values,
    households: Households,
) -> RankingBody:
    """A kept ranking, in the order every ranking is shown (`in_display_order`). Raises a
    404 for an evaluation nobody kept.

    **Read as the live ranking reads** (PL-144, D46): pillars derive from the saved
    contributions, each refusal and warning carries the evidence it read, and the difference
    from home is taken between saved scores. Only the anchor is today's: the household's home
    country, which a saved ranking does not record.
    """
    saved = await evaluations.read_evaluation(evaluation_id)
    results = against_home(
        await evaluations.read_results(evaluation_id), await _home_country(households)
    )
    names = {
        str(candidate.id): candidate.name
        for candidate in await candidates.read_candidates(level=saved.level)
    }
    evidence = await evidence_for(results, values)
    return RankingBody(
        criteria_set=saved.criteria_set,
        level=saved.level,
        computed_at=saved.computed_at,
        score_scale_max=saved.score_scale_max,
        candidates=tuple(
            _result_body(result, names, evidence) for result in in_display_order(results)
        ),
    )


@router.delete(
    "/evaluations/{evaluation_id}",
    operation_id="deleteEvaluation",
    status_code=204,
    response_class=Response,
)
async def delete_evaluation(evaluation_id: int, evaluations: Evaluations) -> None:
    """Discard a kept ranking with its whole tree (D47). Raises a 404 naming an id nobody kept.

    The values and gate answers it cited stay: they belong to the candidates.
    """
    await evaluations.delete(evaluation_id)


@router.get(
    "/evaluations/{evaluation_id}/criteria",
    operation_id="getEvaluationCriteria",
    response_model=EvaluationCriteriaBody,
)
async def get_evaluation_criteria(
    evaluation_id: int, evaluations: Evaluations
) -> EvaluationCriteriaBody:
    """The frozen snapshot: what the weights, goals, bands and anchors actually were."""
    frozen = await evaluations.read_criteria(evaluation_id)
    return EvaluationCriteriaBody(
        pillar_weights=tuple(
            EvaluationPillarWeightBody(
                pillar=str(weight.pillar),
                weight=weight.weight,
                weight_locked=weight.weight_locked,
            )
            for weight in frozen.pillar_weights
        ),
        criteria=tuple(_criterion_body(criterion) for criterion in frozen.criteria),
    )


@router.get(
    "/evaluations/{evaluation_id}/candidates/{candidate_id}",
    operation_id="getCandidateScoreDetail",
    response_model=CandidateScoreDetailBody,
)
async def get_candidate_score_detail(
    evaluation_id: int,
    candidate_id: str,
    evaluations: Evaluations,
    candidates: Candidates,
    values: Values,
    households: Households,
) -> CandidateScoreDetailBody:
    """Why this candidate scored what it scored, attribute by attribute, each figure with its
    source and dates (D46). The difference from home is taken as the saved ranking takes it."""
    saved = await evaluations.read_evaluation(evaluation_id)
    result = await evaluations.read_candidate(evaluation_id, candidate_id)
    names = {
        str(candidate.id): candidate.name
        for candidate in await candidates.read_candidates(level=saved.level)
    }
    result = await _against_saved_home(evaluations, evaluation_id, result, households)
    return score_detail_body(
        result,
        names,
        declared=declared_weights(await evaluations.read_criteria(evaluation_id), saved.level),
        score_scale_max=saved.score_scale_max,
        evidence=await evidence_for((result,), values, contributions=True),
    )


async def _against_saved_home(
    evaluations: Evaluations, evaluation_id: int, result: CandidateResult, households: Households
) -> CandidateResult:
    """One candidate's difference from home, against home's saved score."""
    home = await _home_country(households)
    if home is None or home == str(result.candidate):
        return against_home((result,), home)[0]
    try:
        home_result = await evaluations.read_candidate(evaluation_id, home)
    except UnknownEvaluationError:
        return result
    return against_home((result, home_result), home)[0]


async def _roster_names(candidates: Candidates) -> dict[str, str]:
    return {str(candidate.id): candidate.name for candidate in await candidates.read_candidates()}


def _summary(saved: SavedEvaluation, names: Mapping[str, str]) -> EvaluationSummaryBody:
    return EvaluationSummaryBody(
        id=saved.id,
        criteria_set=saved.criteria_set,
        level=saved.level,
        computed_at=saved.computed_at,
        score_scale_max=saved.score_scale_max,
        note=saved.note,
        leader=(
            None
            if saved.leader is None
            else LeaderBody(
                candidate=saved.leader,
                name=names.get(saved.leader) or readable_identifier(saved.leader),
            )
        ),
    )
