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

from decimal import Decimal

import psycopg
import pytest
from psycopg import errors

from .evaluation_rows import (
    A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW,
    A_SCORE_ON_THE_SCALE,
    THE_FROZEN_SCALE,
    record_a_frozen_anchor,
    record_a_frozen_criterion,
    record_a_result,
    record_an_attribute_score,
    record_an_evaluation,
)

pytestmark = pytest.mark.storage


class TestAnEvaluationFreezesItsScale:
    """The scale is part of the interpretation, and is recorded with it (`reqs.md` Q193)."""

    def test_a_whole_evaluation_inside_its_scale_is_stored(
        self, connection: psycopg.Connection
    ) -> None:
        """The control for every refusal below: all five tables, all values in range."""
        evaluation = record_an_evaluation(connection)
        record_a_frozen_anchor(connection, evaluation)
        result = record_a_result(connection, evaluation)
        record_an_attribute_score(connection, result)

        stored = connection.execute(
            "SELECT score, score_scale_max FROM candidate_result WHERE id = %s", (result,)
        ).fetchone()
        assert stored == (A_SCORE_ON_THE_SCALE, THE_FROZEN_SCALE)

    def test_an_evaluation_cannot_freeze_a_scale_with_no_top(
        self, connection: psycopg.Connection
    ) -> None:
        """A scale of zero has no score that means anything."""
        with pytest.raises(errors.CheckViolation):
            record_an_evaluation(connection, scale=0)

    def test_a_result_cannot_claim_a_scale_its_evaluation_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """What makes the copied scale trustworthy rather than merely present.

        Without this the ceiling below could be satisfied by writing a bigger scale beside the
        bigger score, which would enforce nothing at all.
        """
        evaluation = record_an_evaluation(connection, scale=THE_FROZEN_SCALE)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_result(connection, evaluation, score=None, scale=100)

    def test_a_frozen_anchor_cannot_claim_a_scale_its_evaluation_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """The same pin, on the second of the three tables that stores a score."""
        evaluation = record_an_evaluation(connection, scale=THE_FROZEN_SCALE)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_frozen_anchor(connection, evaluation, scale=100)

    def test_a_per_attribute_score_cannot_claim_a_scale_its_result_did_not_use(
        self, connection: psycopg.Connection
    ) -> None:
        """The third, which inherits the scale from the result rather than the evaluation.

        Pinned all the way down on purpose: a chain that is checked at two links out of three
        can be walked around at the third.
        """
        evaluation = record_an_evaluation(connection, scale=THE_FROZEN_SCALE)
        result = record_a_result(connection, evaluation)

        with pytest.raises(errors.ForeignKeyViolation):
            record_an_attribute_score(connection, result, scale=100)


class TestNoScoreLeavesTheScale:
    """Each of the three tables that stores a score, held to the evaluation's own ceiling."""

    def test_a_candidate_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_result(connection, evaluation, score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW)

    def test_a_frozen_anchor_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_frozen_anchor(
                connection, evaluation, score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW
            )

    def test_a_per_attribute_score_above_the_scale_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """The scale reaches here through the result, not the evaluation, and still binds."""
        evaluation = record_an_evaluation(connection)
        result = record_a_result(connection, evaluation)

        with pytest.raises(errors.CheckViolation):
            record_an_attribute_score(
                connection, result, normalised_score=A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW
            )

    def test_a_negative_score_is_still_refused(self, connection: psycopg.Connection) -> None:
        """The floor the old constraint carried is not lost in gaining a ceiling."""
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_result(connection, evaluation, score=-1)


class TestSharesStayWithinWhatAShareIsOutOf:
    """Coverage and the weights are percentages, so 100 is the real bound and not a setting."""

    def test_coverage_above_a_hundred_is_refused(self, connection: psycopg.Connection) -> None:
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_result(connection, evaluation, coverage=Decimal("101"))

    def test_a_frozen_criterion_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_frozen_criterion(connection, evaluation, weight=Decimal("101"))

    def test_a_frozen_pillar_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            record_a_frozen_criterion(connection, evaluation, pillar_weight=Decimal("101"))

    def test_an_effective_weight_above_a_hundred_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """Redistribution moves weight between criteria and never mints any (`reqs.md` 5.3)."""
        evaluation = record_an_evaluation(connection)
        result = record_a_result(connection, evaluation)

        with pytest.raises(errors.CheckViolation):
            record_an_attribute_score(connection, result, effective_weight=Decimal("101"))
