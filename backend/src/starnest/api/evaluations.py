"""Keeping a ranking, and reading back exactly what was kept (`reqs.md` 3.4a, Q155, Q156).

`GET /rankings` computes and stores nothing; this is where a result is deliberately kept, **with
a frozen copy of the criteria that produced it**. The criteria set stays editable afterwards, so
without the snapshot a saved evaluation would change meaning the next time a weight moved.

The drill-down here is the provenance chain end to end: a total, the attributes behind it, each
one's effective weight after redistribution, and the exact stored value it was computed from.
"""

from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

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
    CandidateResultBody,
    RankingBody,
    _in_rank_order,
    _result_body,
    the_ranking,
)
from starnest.evaluation import AttributeScore, SavedEvaluation

router = APIRouter(tags=["evaluation"])


class EvaluationSummaryBody(BaseModel):
    id: int
    criteria_set: str
    level: str
    computed_at: datetime
    score_scale_max: int
    note: str | None = None


class EvaluationsBody(BaseModel):
    items: tuple[EvaluationSummaryBody, ...]


class SaveEvaluationBody(BaseModel):
    criteria_set: str
    level: str
    note: str | None = None


class AttributeScoreBody(BaseModel):
    attribute: str
    pillar: str
    normalised_score: int | None = None
    effective_weight: float
    contribution: float


class CandidateScoreDetailBody(CandidateResultBody):
    attribute_scores: tuple[AttributeScoreBody, ...] = ()


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
async def list_evaluations(evaluations: Evaluations) -> EvaluationsBody:
    """The kept results, newest first."""
    return EvaluationsBody(
        items=tuple(_summary(saved) for saved in await evaluations.read_evaluations())
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
    return _summary(saved)


@router.get(
    "/evaluations/{evaluation_id}", operation_id="getEvaluation", response_model=RankingBody
)
async def get_evaluation(
    evaluation_id: int, evaluations: Evaluations, candidates: Candidates
) -> RankingBody:
    """A kept ranking, in the order it was kept. Raises a 404 for an evaluation nobody kept."""
    saved = await evaluations.read_evaluation(evaluation_id)
    results = await evaluations.read_results(evaluation_id)
    names = {
        str(candidate.id): candidate.name
        for candidate in await candidates.read_candidates(level=saved.level)
    }
    return RankingBody(
        criteria_set=saved.criteria_set,
        level=saved.level,
        computed_at=saved.computed_at,
        candidates=tuple(_result_body(result, names) for result in _in_rank_order(results)),
    )


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
    evaluation_id: int, candidate_id: str, evaluations: Evaluations, candidates: Candidates
) -> CandidateScoreDetailBody:
    """Why this candidate scored what it scored, attribute by attribute."""
    saved = await evaluations.read_evaluation(evaluation_id)
    result = await evaluations.read_candidate(evaluation_id, candidate_id)
    names = {
        str(candidate.id): candidate.name
        for candidate in await candidates.read_candidates(level=saved.level)
    }
    return CandidateScoreDetailBody(
        **_result_body(result, names).model_dump(),
        attribute_scores=tuple(_attribute_score_body(row) for row in result.attribute_scores),
    )


def _summary(saved: SavedEvaluation) -> EvaluationSummaryBody:
    return EvaluationSummaryBody(
        id=saved.id,
        criteria_set=saved.criteria_set,
        level=saved.level,
        computed_at=saved.computed_at,
        score_scale_max=saved.score_scale_max,
        note=saved.note,
    )


def _attribute_score_body(row: AttributeScore) -> AttributeScoreBody:
    return AttributeScoreBody(
        attribute=str(row.attribute),
        pillar=str(row.pillar),
        normalised_score=row.normalised_score,
        effective_weight=float(row.effective_weight),
        contribution=float(row.contribution),
    )
