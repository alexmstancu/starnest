"""`EvaluationStore` against PostgreSQL: a kept ranking, with the criteria that produced it.

`arch.md` 6.3. Everything a save writes goes in one transaction (`arch.md` 7.1 makes each item
its own, and this item is the whole evaluation): a ranking without its criteria snapshot would
be numbers nobody could account for.

The statements take JSON rather than one row at a time -- `storage/queries/evaluation.sql`
explains why per table -- so this module's work is turning domain objects into the documents
those statements read, and rows back into domain objects.
"""

import json
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any

from psycopg_pool import AsyncConnectionPool

from starnest.candidates import CandidateId
from starnest.criteria import (
    CriteriaSet,
    Criterion,
    Goal,
    NormalisationMethod,
    PillarWeight,
    ScaleAnchor,
)
from starnest.data import AttributeId, CompoundRuleId, MatchRuleId, PillarId, ValueType
from starnest.evaluation import (
    AttributeScore,
    CandidateResult,
    EvaluationStore,
    MatchStatus,
    NonMatch,
    RuleWarning,
    SavedEvaluation,
    UnknownEvaluationError,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresEvaluationStore(EvaluationStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def save(
        self,
        *,
        criteria: CriteriaSet,
        level: str,
        results: Sequence[CandidateResult],
        score_scale_max: int,
        computed_at: datetime,
        note: str | None = None,
    ) -> SavedEvaluation:
        pillar_weights = {
            str(w.pillar): w.weight for w in criteria.pillar_weights if w.level == level
        }
        async with acquire(self._pool) as connection:
            row = await self._queries.insert_evaluation(
                connection,
                criteria_set=str(criteria.id),
                level=level,
                computed_at=computed_at,
                score_scale_max=score_scale_max,
                note=note,
            )
            evaluation = int(row.id)
            await self._queries.insert_evaluation_criteria(
                connection,
                evaluation=evaluation,
                criteria=json.dumps(
                    [_frozen(criterion, pillar_weights) for criterion in criteria.criteria]
                ),
            )
            anchors = [
                {
                    "attribute": str(criterion.attribute),
                    "input_value": str(anchor.input_value),
                    "score": anchor.score,
                    "label": anchor.label,
                }
                for criterion in criteria.criteria
                for anchor in criterion.scale_anchors
            ]
            if anchors:
                await self._queries.insert_evaluation_scale_anchors(
                    connection, evaluation=evaluation, anchors=json.dumps(anchors)
                )
            written = [
                row
                async for row in self._queries.insert_candidate_results(
                    connection,
                    evaluation=evaluation,
                    results=json.dumps([_result(result) for result in results]),
                )
            ]
            identifiers = {row.candidate: row.id for row in written}
            scores = [
                {
                    "candidate_result": identifiers[str(result.candidate)],
                    "attribute": str(row.attribute),
                    "used_value": row.used_value,
                    "normalised_score": row.normalised_score,
                    "effective_weight": str(row.effective_weight),
                    "contribution": str(row.contribution),
                }
                for result in results
                for row in result.attribute_scores
            ]
            if scores:
                await self._queries.insert_candidate_attribute_scores(
                    connection, scores=json.dumps(scores)
                )
            reasons = [
                {
                    "candidate_result": identifiers[str(result.candidate)],
                    "attribute": None if reason.criterion is None else str(reason.criterion),
                    "match_rule": None if reason.match_rule is None else str(reason.match_rule),
                    "compound_rule": (
                        None if reason.compound_rule is None else str(reason.compound_rule)
                    ),
                    "reason_detail": reason.reason_detail,
                }
                for result in results
                for reason in result.non_match_reasons
            ]
            if reasons:
                await self._queries.insert_non_match_reasons(
                    connection, reasons=json.dumps(reasons)
                )
            warnings = [
                {
                    "candidate_result": identifiers[str(result.candidate)],
                    "compound_rule": str(flag.compound_rule),
                    "detail": flag.detail,
                }
                for result in results
                for flag in result.warnings
            ]
            if warnings:
                await self._queries.insert_candidate_warnings(
                    connection, warnings=json.dumps(warnings)
                )
        return SavedEvaluation(
            id=evaluation,
            criteria_set=str(criteria.id),
            level=level,
            computed_at=computed_at,
            score_scale_max=score_scale_max,
            note=note,
        )

    async def read_evaluations(self) -> tuple[SavedEvaluation, ...]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_evaluations(connection)]
        return tuple(_saved(row) for row in rows)

    async def read_evaluation(self, evaluation: int) -> SavedEvaluation:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_evaluation(connection, evaluation=evaluation)
        if row is None:
            raise UnknownEvaluationError(f"there is no evaluation numbered {evaluation}")
        return _saved(row)

    async def read_results(self, evaluation: int) -> tuple[CandidateResult, ...]:
        await self.read_evaluation(evaluation)
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_evaluation_results(
                    connection, evaluation=evaluation
                )
            ]
        return tuple(_result_from(row) for row in rows)

    async def read_criteria(self, evaluation: int) -> CriteriaSet:
        saved = await self.read_evaluation(evaluation)
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_evaluation_criteria(
                    connection, evaluation=evaluation
                )
            ]
        weights = {row.pillar: Decimal(row.pillar_weight) for row in rows}
        return CriteriaSet(
            id=saved.criteria_set,
            name=saved.criteria_set,
            criteria=tuple(_criterion_from(row, saved) for row in rows),
            pillar_weights=tuple(
                PillarWeight(pillar=PillarId(pillar), level=saved.level, weight=weight)
                for pillar, weight in sorted(weights.items())
            ),
        )

    async def read_candidate(self, evaluation: int, candidate: str) -> CandidateResult:
        await self.read_evaluation(evaluation)
        async with acquire(self._pool) as connection:
            head = await self._queries.select_candidate_result(
                connection, evaluation=evaluation, candidate=candidate
            )
            if head is None:
                raise UnknownEvaluationError(
                    f"evaluation {evaluation} has no result for {candidate!r}"
                )
            rows = [
                row
                async for row in self._queries.select_candidate_attribute_scores(
                    connection, evaluation=evaluation, candidate=candidate
                )
            ]
        return _result_from(
            head, attribute_scores=tuple(_attribute_score_from(row) for row in rows)
        )


def _frozen(criterion: Criterion, pillar_weights: dict[str, Decimal]) -> dict[str, Any]:
    """One criterion as the snapshot stores it, with its pillar's weight copied in beside it."""
    return {
        "attribute": str(criterion.attribute),
        "pillar": str(criterion.pillar),
        "is_scored": criterion.is_scored,
        "weight": str(criterion.weight),
        "pillar_weight": str(pillar_weights.get(str(criterion.pillar), Decimal(0))),
        "goal": str(criterion.goal),
        "target_range_min": _number(criterion.target_range_min),
        "target_range_max": _number(criterion.target_range_max),
        "zero_score_below": _number(criterion.zero_score_below),
        "zero_score_above": _number(criterion.zero_score_above),
        "normalisation_method": str(criterion.normalisation_method),
        "breakdown_option": str(criterion.breakdown_option) if criterion.breakdown_option else None,
        "reducer_mode": str(criterion.reducer_mode) if criterion.reducer_mode else None,
        "blocks_if_missing": criterion.blocks_if_missing,
    }


def _result(result: CandidateResult) -> dict[str, Any]:
    return {
        "candidate": str(result.candidate),
        "score": result.score,
        "coverage": str(result.coverage),
        "match_status": str(result.match_status),
        # Not yet computed anywhere: a city evaluated although its country does not match is
        # P5's city-level work, and the column is written false rather than left to a default
        # so that the saved row says what this evaluation actually knew.
        "parent_not_matching": False,
        "rank": result.rank,
    }


def _number(figure: Decimal | None) -> str | None:
    return None if figure is None else str(figure)


def _saved(row: Any) -> SavedEvaluation:
    return SavedEvaluation(
        id=row.id,
        criteria_set=row.criteria_set,
        level=row.level,
        computed_at=row.computed_at,
        score_scale_max=row.score_scale_max,
        note=row.note,
    )


def _result_from(row: Any, attribute_scores: tuple[AttributeScore, ...] = ()) -> CandidateResult:
    return CandidateResult(
        candidate=CandidateId(row.candidate),
        score=row.score,
        coverage=Decimal(row.coverage),
        match_status=MatchStatus(row.match_status),
        rank=row.rank,
        attribute_scores=attribute_scores,
        warnings=tuple(
            RuleWarning(compound_rule=CompoundRuleId(flag["compound_rule"]), detail=flag["detail"])
            for flag in getattr(row, "warnings", []) or []
        ),
        non_match_reasons=tuple(
            NonMatch(
                reason_detail=reason["detail"],
                criterion=None if reason["attribute"] is None else AttributeId(reason["attribute"]),
                match_rule=(
                    None if reason["match_rule"] is None else MatchRuleId(reason["match_rule"])
                ),
                compound_rule=(
                    None
                    if reason["compound_rule"] is None
                    else CompoundRuleId(reason["compound_rule"])
                ),
            )
            for reason in getattr(row, "non_match_reasons", []) or []
        ),
    )


def _attribute_score_from(row: Any) -> AttributeScore:
    return AttributeScore(
        attribute=AttributeId(row.attribute),
        pillar=PillarId(row.pillar),
        normalised_score=row.normalised_score,
        effective_weight=Decimal(row.effective_weight),
        contribution=Decimal(row.contribution),
        used_value=row.used_value,
    )


def _criterion_from(row: Any, saved: SavedEvaluation) -> Criterion:
    return Criterion(
        criteria_set=saved.criteria_set,
        attribute=AttributeId(row.attribute),
        pillar=PillarId(row.pillar),
        value_type=ValueType(row.value_type),
        is_scored=row.is_scored,
        weight=Decimal(row.weight),
        goal=Goal(row.goal),
        normalisation_method=NormalisationMethod(row.normalisation_method),
        target_range_min=_decimal(row.target_range_min),
        target_range_max=_decimal(row.target_range_max),
        zero_score_below=_decimal(row.zero_score_below),
        zero_score_above=_decimal(row.zero_score_above),
        blocks_if_missing=row.blocks_if_missing,
        scale_anchors=tuple(
            ScaleAnchor(
                input_value=Decimal(str(anchor["input_value"])),
                score=anchor["score"],
                label=anchor["label"],
            )
            for anchor in row.scale_anchors
        ),
    )


def _decimal(figure: Any) -> Decimal | None:
    return None if figure is None else Decimal(figure)
