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
    BooleanThreshold,
    CriteriaSet,
    Criterion,
    Goal,
    LabelThreshold,
    MatchingThreshold,
    NormalisationMethod,
    PillarWeight,
    RangeThreshold,
    ReducerMode,
    ScaleAnchor,
    ShareThreshold,
)
from starnest.data import (
    AttributeId,
    BreakdownOptionId,
    CompoundRuleId,
    ConfidenceLevel,
    MatchRuleId,
    PillarId,
    ValueType,
)
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
from starnest.evaluation.ranking import pillars_of
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries

TEST_EVALUATION_MARKER = "[e2e] "
"""What the browser suite prefixes its notes with, so the boot sweep can find them.

**Square brackets, and a prefix rather than a substring**, because a human typing a note is
choosing to keep something and must not lose it to a match. The other half of this string is in
`ui/e2e/sanity.spec.ts`: the two sides share no code, not even DTO definitions, so an acceptance
test pins the literal rather than an import doing it.
"""


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
        pillar_locks = {
            str(w.pillar): w.weight_locked for w in criteria.pillar_weights if w.level == level
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
                    [
                        _frozen(criterion, pillar_weights, pillar_locks)
                        for criterion in criteria.criteria
                    ]
                ),
            )
            # Which gates this reading enforced and which compound rules it applied, frozen so a
            # reopened set says what it screened on rather than what the live set screens on now
            # (ST-07). A row means on; off is the absence of a row, as for a live set.
            if criteria.enforced_match_rules:
                await self._queries.insert_evaluation_match_rules(
                    connection,
                    evaluation=evaluation,
                    match_rules=[str(rule) for rule in sorted(criteria.enforced_match_rules)],
                )
            if criteria.applied_compound_rules:
                await self._queries.insert_evaluation_compound_rules(
                    connection,
                    evaluation=evaluation,
                    compound_rules=[str(rule) for rule in sorted(criteria.applied_compound_rules)],
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
            # The value rows behind each warning, written after the warnings so the foreign key
            # holds (ST-07). A warning with no input ids contributes none. The ordinal is the
            # condition index, so the figures read back in the order the rule names them.
            warning_inputs = [
                {
                    "candidate_result": identifiers[str(result.candidate)],
                    "compound_rule": str(flag.compound_rule),
                    "value_id": value_id,
                    "ordinal": ordinal,
                }
                for result in results
                for flag in result.warnings
                for ordinal, value_id in enumerate(flag.input_values)
            ]
            if warning_inputs:
                await self._queries.insert_candidate_warning_inputs(
                    connection, inputs=json.dumps(warning_inputs)
                )
            # The value rows behind each not_matching compound rule -- the mirror of the warning
            # inputs, so a saved non-match keeps the source/date chain that produced it (ST-07).
            # Only a compound rule reads stored figures; a gate or a criterion threshold has none.
            non_match_inputs = [
                {
                    "candidate_result": identifiers[str(result.candidate)],
                    "compound_rule": str(reason.compound_rule),
                    "value_id": value_id,
                    "ordinal": ordinal,
                }
                for result in results
                for reason in result.non_match_reasons
                if reason.compound_rule is not None
                for ordinal, value_id in enumerate(reason.input_values)
            ]
            if non_match_inputs:
                await self._queries.insert_non_match_inputs(
                    connection, inputs=json.dumps(non_match_inputs)
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
            enforced = [
                row.match_rule
                async for row in self._queries.select_evaluation_match_rules(
                    connection, evaluation=evaluation
                )
            ]
            applied = [
                row.compound_rule
                async for row in self._queries.select_evaluation_compound_rules(
                    connection, evaluation=evaluation
                )
            ]
        # The pillar weight and its lock are copied onto every criterion row of that pillar, so
        # either is read once per pillar (ST-07): a reopened set shows the pillar locked as it
        # was, and the gates and compound rules it screened on rather than the live set's.
        weights = {row.pillar: Decimal(row.pillar_weight) for row in rows}
        locks = {row.pillar: row.pillar_weight_locked for row in rows}
        return CriteriaSet(
            id=saved.criteria_set,
            name=saved.criteria_set,
            criteria=tuple(_criterion_from(row, saved) for row in rows),
            pillar_weights=tuple(
                PillarWeight(
                    pillar=PillarId(pillar),
                    level=saved.level,
                    weight=weight,
                    weight_locked=locks.get(pillar, False),
                )
                for pillar, weight in sorted(weights.items())
            ),
            enforced_match_rules=frozenset(MatchRuleId(rule) for rule in enforced),
            applied_compound_rules=frozenset(CompoundRuleId(rule) for rule in applied),
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

    async def sweep_test_evaluations(self) -> int:
        """Discard what the browser suite saved. `0482` cascades the snapshot with it."""
        async with acquire(self._pool) as connection:
            row = await self._queries.sweep_test_evaluations(
                connection, marker=TEST_EVALUATION_MARKER
            )
        return int(row.discarded)


def _frozen(
    criterion: Criterion,
    pillar_weights: dict[str, Decimal],
    pillar_locks: dict[str, bool],
) -> dict[str, Any]:
    """One criterion as the snapshot stores it, with its pillar's weight and lock copied in
    beside it (ST-07/08) -- the pillar lock frozen here so a reopened set shows the pillar
    locked as it was, not unlocked as a live default."""
    return {
        "attribute": str(criterion.attribute),
        "pillar": str(criterion.pillar),
        # Frozen with the rest (ST-08): the type the criterion was scored under, not whatever the
        # attribute may be retyped to later.
        "value_type": str(criterion.value_type),
        "is_scored": criterion.is_scored,
        "weight": str(criterion.weight),
        "weight_locked": criterion.weight_locked,
        "pillar_weight": str(pillar_weights.get(str(criterion.pillar), Decimal(0))),
        "pillar_weight_locked": pillar_locks.get(str(criterion.pillar), False),
        "goal": str(criterion.goal),
        "target_range_min": _number(criterion.target_range_min),
        "target_range_max": _number(criterion.target_range_max),
        "zero_score_below": _number(criterion.zero_score_below),
        "zero_score_above": _number(criterion.zero_score_above),
        "normalisation_method": str(criterion.normalisation_method),
        "breakdown_option": str(criterion.breakdown_option) if criterion.breakdown_option else None,
        "reducer_mode": str(criterion.reducer_mode) if criterion.reducer_mode else None,
        "blocks_if_missing": criterion.blocks_if_missing,
        "matching_threshold": _threshold_to_json(criterion.matching_threshold),
    }


# The four threshold shapes, by the name stored beside each frozen threshold. A saved ranking
# never re-evaluates the threshold -- the match outcome is frozen in `non_match_reason` -- so it
# is kept as one object for the record rather than mirroring the four live child tables.
_THRESHOLD_SHAPES: dict[str, type[MatchingThreshold]] = {
    "RangeThreshold": RangeThreshold,
    "BooleanThreshold": BooleanThreshold,
    "LabelThreshold": LabelThreshold,
    "ShareThreshold": ShareThreshold,
}


def _threshold_to_json(threshold: MatchingThreshold | None) -> dict[str, Any] | None:
    """The typed threshold as one tagged object, or None. The `kind` names the shape so the
    read can rebuild the right one; the rest is the threshold's own fields."""
    if threshold is None:
        return None
    return {"kind": type(threshold).__name__, **threshold.model_dump(mode="json")}


def _threshold_from_json(frozen: dict[str, Any] | None) -> MatchingThreshold | None:
    """The tagged object back into its typed threshold, or None when none was frozen."""
    if frozen is None:
        return None
    shape = _THRESHOLD_SHAPES[frozen["kind"]]
    return shape(**{field: value for field, value in frozen.items() if field != "kind"})


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
        # **Stored, never recomputed on the way out** (`0486`). Recomputing the split would
        # read today's values through today's source priority, and an evaluation exists
        # precisely so that it does not move.
        **{
            f"coverage_{grade.value}": _number(result.coverage_by_confidence.get(grade))
            for grade in ConfidenceLevel
        },
        "insufficient_reason": result.insufficient_reason,
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
        # An evaluation saved before `0486` has no split: an empty mapping is what the domain
        # already means by "nothing covered", and it is the honest answer for a row that never
        # recorded one. A share that was stored as zero comes back as zero.
        coverage_by_confidence={
            grade: Decimal(share)
            for grade in ConfidenceLevel
            if (share := getattr(row, f"coverage_{grade.value}", None)) is not None
        },
        insufficient_reason=getattr(row, "insufficient_reason", None),
        attribute_scores=attribute_scores,
        # **Derived from the breakdown, never stored** -- the same shape as `RunDetail.by_source`
        # and for the same reason: a rollup kept beside the rows it rolls up is a second copy
        # that can disagree with them. The live path calls this function on the same input, so
        # the two cannot drift; leaving it empty here is what made a saved drill-down show no
        # pillar cards at all while the live one showed eleven.
        pillar_scores=pillars_of(attribute_scores),
        warnings=tuple(
            RuleWarning(
                compound_rule=CompoundRuleId(flag["compound_rule"]),
                detail=flag["detail"],
                input_values=tuple(flag.get("input_values", [])),
            )
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
                input_values=tuple(reason.get("input_values", [])),
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
        weight_locked=row.weight_locked,
        goal=Goal(row.goal),
        normalisation_method=NormalisationMethod(row.normalisation_method),
        target_range_min=_decimal(row.target_range_min),
        target_range_max=_decimal(row.target_range_max),
        zero_score_below=_decimal(row.zero_score_below),
        zero_score_above=_decimal(row.zero_score_above),
        breakdown_option=(
            BreakdownOptionId(row.breakdown_option) if row.breakdown_option else None
        ),
        reducer_mode=ReducerMode(row.reducer_mode) if row.reducer_mode else None,
        blocks_if_missing=row.blocks_if_missing,
        matching_threshold=_threshold_from_json(row.matching_threshold),
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
