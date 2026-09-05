"""A row that hangs off an evaluation belongs to that evaluation, and to nothing else.

Two refusals migration 0108 adds, both about a child that could name a parent it does not have.

**A result at the wrong level** (known-issues D2). `candidate_result` named a candidate and an
evaluation with nothing tying them together, so a city could be ranked inside a country
evaluation. `reqs.md` 3.1 orders the levels and an evaluation runs at one of them, which is
what stops a comparison mixing them -- and the ranking table was the one place that could.

**A reason pointing at a live criterion** (known-issues D26). It referenced `criterion(id)`
while every other child of an evaluation references the frozen twin. Nothing orphaned, because
the key restricts; the failure ran the other way, and `TestDeletingACriterionAfterAnEvaluation`
below is the one that would have caught it -- a routine user action that starts erroring
permanently once a single evaluation has been saved.

Every refusal has a control beside it that differs in one column only, for the reason
`test_criteria_constraint_behaviour.py` sets out: this suite has twice had a test agree with a
constraint's name rather than its behaviour.
"""

import psycopg
import pytest
from psycopg import errors

from .evaluation_rows import (
    A_SEEDED_ATTRIBUTE,
    A_SEEDED_CANDIDATE,
    A_SEEDED_LEVEL,
    THE_NESTED_LEVEL,
    record_a_city,
    record_a_frozen_criterion,
    record_a_non_match_reason,
    record_a_result,
    record_an_evaluation,
)

pytestmark = pytest.mark.storage

A_CITY = "city.lisbon"
A_GATE = "eu_free_movement"


class TestAResultSitsAtItsEvaluationsLevel:
    """An evaluation runs at one level, and everything it ranks is at that level."""

    def test_a_country_is_ranked_in_a_country_evaluation(
        self, connection: psycopg.Connection
    ) -> None:
        """The control."""
        evaluation = record_an_evaluation(connection, level=A_SEEDED_LEVEL)

        result = record_a_result(connection, evaluation, level=A_SEEDED_LEVEL)

        stored = connection.execute(
            "SELECT level FROM candidate_result WHERE id = %s", (result,)
        ).fetchone()
        assert stored == (A_SEEDED_LEVEL,)

    def test_a_result_cannot_claim_a_level_its_evaluation_did_not_run_at(
        self, connection: psycopg.Connection
    ) -> None:
        """The first of the two keys: the row's level is the evaluation's."""
        evaluation = record_an_evaluation(connection, level=A_SEEDED_LEVEL)
        record_a_city(connection, city=A_CITY, country=A_SEEDED_CANDIDATE)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_result(connection, evaluation, candidate=A_CITY, level=THE_NESTED_LEVEL)

    def test_a_city_cannot_be_ranked_inside_a_country_evaluation(
        self, connection: psycopg.Connection
    ) -> None:
        """The second key, and the defect as reported.

        Naming the evaluation's own level does not smuggle the city in: the candidate has to
        actually be at the level the row claims.
        """
        evaluation = record_an_evaluation(connection, level=A_SEEDED_LEVEL)
        record_a_city(connection, city=A_CITY, country=A_SEEDED_CANDIDATE)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_result(connection, evaluation, candidate=A_CITY, level=A_SEEDED_LEVEL)

    def test_a_city_is_ranked_in_a_city_evaluation(self, connection: psycopg.Connection) -> None:
        """The other control. Cities are not refused -- city results in city evaluations are."""
        evaluation = record_an_evaluation(connection, level=THE_NESTED_LEVEL)
        record_a_city(connection, city=A_CITY, country=A_SEEDED_CANDIDATE)

        result = record_a_result(connection, evaluation, candidate=A_CITY, level=THE_NESTED_LEVEL)

        stored = connection.execute(
            "SELECT candidate, level FROM candidate_result WHERE id = %s", (result,)
        ).fetchone()
        assert stored == (A_CITY, THE_NESTED_LEVEL)


class TestAReasonNamesTheEvaluationsOwnFrozenCriterion:
    """The reason a candidate is out reads the interpretation that ruled it out, not today's."""

    def test_a_reason_naming_a_frozen_criterion_is_stored(
        self, connection: psycopg.Connection
    ) -> None:
        """The control."""
        evaluation = record_an_evaluation(connection)
        record_a_frozen_criterion(connection, evaluation)
        result = record_a_result(connection, evaluation)

        record_a_non_match_reason(connection, result, evaluation=evaluation)

        stored = connection.execute(
            "SELECT attribute FROM non_match_reason WHERE candidate_result = %s", (result,)
        ).fetchone()
        assert stored == (A_SEEDED_ATTRIBUTE,)

    def test_a_reason_cannot_name_an_attribute_the_evaluation_did_not_freeze(
        self, connection: psycopg.Connection
    ) -> None:
        """An attribute nobody weighted cannot have ruled anybody out."""
        evaluation = record_an_evaluation(connection)
        result = record_a_result(connection, evaluation)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_non_match_reason(connection, result, evaluation=evaluation)

    def test_a_reason_cannot_belong_to_a_different_evaluation_than_its_result(
        self, connection: psycopg.Connection
    ) -> None:
        """What stops the frozen-criterion key being satisfied by borrowing another snapshot."""
        ruling = record_an_evaluation(connection)
        record_a_frozen_criterion(connection, ruling)
        elsewhere = record_an_evaluation(connection)
        result = record_a_result(connection, elsewhere)

        with pytest.raises(errors.ForeignKeyViolation):
            record_a_non_match_reason(connection, result, evaluation=ruling)

    def test_a_reason_names_exactly_one_of_the_two_mechanisms(
        self, connection: psycopg.Connection
    ) -> None:
        """A criterion threshold and a gate are different answers to "why is it out"."""
        evaluation = record_an_evaluation(connection)
        record_a_frozen_criterion(connection, evaluation)
        result = record_a_result(connection, evaluation)

        with pytest.raises(errors.CheckViolation):
            record_a_non_match_reason(connection, result, evaluation=evaluation, match_rule=A_GATE)

    def test_a_reason_naming_a_gate_rather_than_a_criterion_is_stored(
        self, connection: psycopg.Connection
    ) -> None:
        """Both mechanisms feed one surface (`reqs.md` 5.2), so a gate reason is not an oddity."""
        evaluation = record_an_evaluation(connection)
        result = record_a_result(connection, evaluation)

        record_a_non_match_reason(
            connection, result, evaluation=evaluation, attribute=None, match_rule=A_GATE
        )

        stored = connection.execute(
            "SELECT attribute, match_rule FROM non_match_reason WHERE candidate_result = %s",
            (result,),
        ).fetchone()
        assert stored == (None, A_GATE)


class TestDeletingACriterionAfterAnEvaluation:
    """The defect D26 actually caused, stated as the user action that used to break."""

    def test_a_criterion_can_still_be_removed_from_a_set_once_an_evaluation_has_ruled_on_it(
        self, connection: psycopg.Connection
    ) -> None:
        """Under the old foreign key this raised, and went on raising forever.

        `non_match_reason.criterion` referenced the live criterion, so the delete that removes
        a criterion from a criteria set was restricted by every saved evaluation that had ever
        recorded a non-match on it. Nothing in the interface could clear that, and nothing on
        screen said why.
        """
        evaluation = record_an_evaluation(connection)
        record_a_frozen_criterion(connection, evaluation)
        result = record_a_result(connection, evaluation)
        record_a_non_match_reason(connection, result, evaluation=evaluation)

        connection.execute(
            "DELETE FROM criterion WHERE criteria_set = %s AND attribute = %s",
            ("local_employment", A_SEEDED_ATTRIBUTE),
        )

        remaining = connection.execute(
            "SELECT count(*) FROM criterion WHERE criteria_set = %s AND attribute = %s",
            ("local_employment", A_SEEDED_ATTRIBUTE),
        ).fetchone()
        assert remaining == (0,)
