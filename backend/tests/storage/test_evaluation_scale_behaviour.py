"""No score an evaluation stores may leave the scale that evaluation froze.

Six columns across four tables carried a floor and no ceiling, so `score = 999` and
`coverage = 4200` both inserted (known-issues D3, D25). Migration 0107 closes all six, and the
ceiling for a score is the evaluation's own frozen `score_scale_max` rather than a literal --
`settings.score_scale_max` is configurable (`reqs.md` 3.10) and a saved evaluation must keep
reading on the scale it was computed on (`reqs.md` Q193).

**The frozen scale in these tests is 10, not 100.** That is the whole point of the file. A score
of 50 is legal under a hardcoded `<= 100` and illegal under the scale actually in force, so any
future "fix" that restates 100 as a literal turns these tests red instead of green. Where 100 IS
the real bound -- coverage and the weights, which are shares -- the tests use 101 instead.

**Nothing here reads `pg_constraint`**, for the reason `test_criteria_constraint_behaviour.py`
gives at length: this suite has twice had a test agree with a constraint's name rather than its
behaviour. Every check writes a row and reports what the database said, and every refusal has a
control beside it that differs in one column only.

The `connection` fixture rolls back, so no evaluation written here outlives its test.
"""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.storage

A_SEEDED_SET = "local_employment"
A_SEEDED_LEVEL = "country"
A_SEEDED_CANDIDATE = "country.portugal"
A_SEEDED_ATTRIBUTE = "country.cost_of_living_index"
ITS_PILLAR = "economics"

THE_FROZEN_SCALE = 10
"""Deliberately not 100. A score of 50 is inside a hardcoded ceiling and outside this one."""

A_SCORE_ON_THE_SCALE = 7
A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW = 50


def _record_an_evaluation(connection: psycopg.Connection, *, scale: int = THE_FROZEN_SCALE) -> int:
    """One saved evaluation, carrying the scale its scores are on."""
    row = connection.execute(
        """
        INSERT INTO evaluation (criteria_set, level, computed_at, score_scale_max)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (A_SEEDED_SET, A_SEEDED_LEVEL, datetime.now(UTC), scale),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _record_a_result(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    score: int | None = A_SCORE_ON_THE_SCALE,
    coverage: Decimal = Decimal("80"),
    scale: int = THE_FROZEN_SCALE,
) -> int:
    row = connection.execute(
        """
        INSERT INTO candidate_result (evaluation, candidate, score, coverage, match_status,
                                      score_scale_max)
        VALUES (%s, %s, %s, %s, 'matching', %s)
        RETURNING id
        """,
        (evaluation, A_SEEDED_CANDIDATE, score, coverage, scale),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _record_a_frozen_criterion(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    weight: Decimal = Decimal("40"),
    pillar_weight: Decimal = Decimal("30"),
) -> None:
    connection.execute(
        """
        INSERT INTO evaluation_criterion (evaluation, attribute, pillar, is_scored, weight,
                                          pillar_weight, goal, normalisation_method,
                                          blocks_if_missing)
        VALUES (%s, %s, %s, true, %s, %s, 'minimise', 'percentile', false)
        """,
        (evaluation, A_SEEDED_ATTRIBUTE, ITS_PILLAR, weight, pillar_weight),
    )


def _record_a_frozen_anchor(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    score: int = A_SCORE_ON_THE_SCALE,
    scale: int = THE_FROZEN_SCALE,
) -> None:
    _record_a_frozen_criterion(connection, evaluation)
    connection.execute(
        """
        INSERT INTO evaluation_scale_anchor (evaluation, attribute, input_value, score,
                                             score_scale_max)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (evaluation, A_SEEDED_ATTRIBUTE, Decimal("500"), score, scale),
    )


def _record_an_attribute_score(
    connection: psycopg.Connection,
    result: int,
    *,
    normalised_score: int | None = A_SCORE_ON_THE_SCALE,
    effective_weight: Decimal = Decimal("40"),
    scale: int = THE_FROZEN_SCALE,
) -> None:
    connection.execute(
        """
        INSERT INTO candidate_attribute_score (candidate_result, attribute, normalised_score,
                                               effective_weight, contribution, score_scale_max)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (result, A_SEEDED_ATTRIBUTE, normalised_score, effective_weight, Decimal("2.8"), scale),
    )


class TestAnEvaluationFreezesItsScale:
    """The scale is part of the interpretation, and is recorded with it (`reqs.md` Q193)."""

    def test_a_whole_evaluation_inside_its_scale_is_stored(
        self, connection: psycopg.Connection
    ) -> None:
        """The control for every refusal below: all five tables, all values in range."""
        evaluation = _record_an_evaluation(connection)
        _record_a_frozen_anchor(connection, evaluation)
        result = _record_a_result(connection, evaluation)
        _record_an_attribute_score(connection, result)

        stored = connection.execute(
            "SELECT score, score_scale_max FROM candidate_result WHERE id = %s", (result,)
        ).fetchone()
        assert stored == (A_SCORE_ON_THE_SCALE, THE_FROZEN_SCALE)

    def test_an_evaluation_cannot_freeze_a_scale_with_no_top(
        self, connection: psycopg.Connection
    ) -> None:
        """A scale of zero has no score that means anything."""
        with pytest.raises(errors.CheckViolation):
            _record_an_evaluation(connection, scale=0)

    def test_a_result_cannot_claim_a_scale_its_evaluation_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """What makes the copied scale trustworthy rather than merely present.

        Without this the ceiling below could be satisfied by writing a bigger scale beside the
        bigger score, which would enforce nothing at all.
        """
        evaluation = _record_an_evaluation(connection, scale=THE_FROZEN_SCALE)

        with pytest.raises(errors.ForeignKeyViolation):
            _record_a_result(connection, evaluation, score=None, scale=100)

    def test_a_frozen_anchor_cannot_claim_a_scale_its_evaluation_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """The same pin, on the second of the three tables that stores a score."""
        evaluation = _record_an_evaluation(connection, scale=THE_FROZEN_SCALE)

        with pytest.raises(errors.ForeignKeyViolation):
            _record_a_frozen_anchor(connection, evaluation, scale=100)

    def test_a_per_attribute_score_cannot_claim_a_scale_its_result_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """The third, which inherits the scale from the result rather than the evaluation.

        Pinned all the way down on purpose: a chain that is checked at two links out of three
        can be walked around at the third.
        """
        evaluation = _record_an_evaluation(connection, scale=THE_FROZEN_SCALE)
        result = _record_a_result(connection, evaluation)

        with pytest.raises(errors.ForeignKeyViolation):
            _record_an_attribute_score(connection, result, scale=100)


class TestNoScoreLeavesTheScale:
    """Each of the three tables that stores a score, held to the evaluation's own ceiling."""

    def test_a_candidate_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_result(connection, evaluation, score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW)

    def test_a_frozen_anchor_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_frozen_anchor(
                connection, evaluation, score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW
            )

    def test_a_per_attribute_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """The scale reaches here through the result, not the evaluation, and still binds."""
        evaluation = _record_an_evaluation(connection)
        result = _record_a_result(connection, evaluation)

        with pytest.raises(errors.CheckViolation):
            _record_an_attribute_score(
                connection, result, normalised_score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW
            )

    def test_a_negative_score_is_still_refused(self, connection: psycopg.Connection) -> None:
        """The floor the old constraint carried is not lost in gaining a ceiling."""
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_result(connection, evaluation, score=-1)


class TestSharesStayWithinWhatAShareIsOutOf:
    """Coverage and the weights are percentages, so 100 is the real bound and not a setting."""

    def test_coverage_above_a_hundred_is_refused(self, connection: psycopg.Connection) -> None:
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_result(connection, evaluation, coverage=Decimal("101"))

    def test_a_frozen_criterion_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_frozen_criterion(connection, evaluation, weight=Decimal("101"))

    def test_a_frozen_pillar_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = _record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            _record_a_frozen_criterion(connection, evaluation, pillar_weight=Decimal("101"))

    def test_an_effective_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """Redistribution moves weight between criteria and never mints any (`reqs.md` 5.3)."""
        evaluation = _record_an_evaluation(connection)
        result = _record_a_result(connection, evaluation)

        with pytest.raises(errors.CheckViolation):
            _record_an_attribute_score(connection, result, effective_weight=Decimal("101"))
