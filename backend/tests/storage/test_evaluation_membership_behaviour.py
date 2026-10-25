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

from collections.abc import Callable, Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

from .evaluation_rows import (
    A_SEEDED_ATTRIBUTE,
    A_SEEDED_CANDIDATE,
    A_SEEDED_LEVEL,
    THE_NESTED_LEVEL,
    record_a_city,
    record_a_figure,
    record_a_frozen_criterion,
    record_a_non_match_reason,
    record_a_result,
    record_an_attribute_score,
    record_an_evaluation,
)

pytestmark = pytest.mark.storage

A_CITY = "city.lisbon"
A_GATE = "eu_free_movement"
ANOTHER_CANDIDATE = "country.greece"
ANOTHER_ATTRIBUTE = "country.homicide_rate"
A_COMPOUND_RULE = "cheap_but_taxed"
A_GATE_AT_EVERY_LEVEL = "not_manually_excluded"

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_PINS = next(MIGRATIONS.glob("0523-*[!k].sql"))
THEIR_ROLLBACK = THE_PINS.with_name(f"{THE_PINS.stem}.rollback.sql")


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


def refused_by(connection: psycopg.Connection, write: Callable[[], object]) -> str | None:
    """The constraint `write` broke, inside a savepoint so the test goes on; None if it held.

    Named rather than merely caught, because a row built to break one key may break another
    first, and a test passing on the wrong refusal proves nothing about the one it names."""
    try:
        with connection.transaction():
            write()
    except (errors.ForeignKeyViolation, errors.UniqueViolation) as refusal:
        return refusal.diag.constraint_name
    return None


@pytest.fixture
def a_result_with_its_criterion(connection: psycopg.Connection) -> tuple[int, int]:
    """Portugal's result in an evaluation that froze the seeded attribute: (evaluation, result)."""
    evaluation = record_an_evaluation(connection)
    record_a_frozen_criterion(connection, evaluation)
    return evaluation, record_a_result(connection, evaluation)


class TestAContributionNamesItsOwnMeasurement:
    """ST-13 (`0523`): a contribution cites only its own candidate's figure for its own
    attribute, and only an attribute its evaluation froze."""

    def test_its_own_candidates_figure_and_no_figure_are_both_stored(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        """The controls: the seeded attribute twice over would break the primary key, so the
        empty contribution sits in a second result."""
        evaluation, result = a_result_with_its_criterion
        figure = record_a_figure(connection)

        assert (
            refused_by(
                connection, lambda: record_an_attribute_score(connection, result, used_value=figure)
            )
            is None
        )
        other = record_a_result(connection, evaluation, candidate=ANOTHER_CANDIDATE)
        assert refused_by(connection, lambda: record_an_attribute_score(connection, other)) is None

    @pytest.mark.parametrize(
        ("candidate", "attribute"),
        [(ANOTHER_CANDIDATE, A_SEEDED_ATTRIBUTE), (A_SEEDED_CANDIDATE, ANOTHER_ATTRIBUTE)],
        ids=["another candidate's", "another attribute's"],
    )
    def test_a_figure_that_is_not_its_own_is_refused(
        self,
        connection: psycopg.Connection,
        a_result_with_its_criterion: tuple[int, int],
        candidate: str,
        attribute: str,
    ) -> None:
        """Mutation: drop `candidate_attribute_score_cites_its_own_measurement` and both store."""
        _evaluation, result = a_result_with_its_criterion
        figure = record_a_figure(connection, candidate=candidate, attribute=attribute)

        assert (
            refused_by(
                connection, lambda: record_an_attribute_score(connection, result, used_value=figure)
            )
            == "candidate_attribute_score_cites_its_own_measurement"
        )

    def test_it_cannot_claim_another_candidate_than_its_results(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        """What keeps the figure's pin from being met by restating the figure's candidate."""
        _evaluation, result = a_result_with_its_criterion
        theirs = record_a_figure(connection, candidate=ANOTHER_CANDIDATE)

        assert (
            refused_by(
                connection,
                lambda: record_an_attribute_score(
                    connection, result, used_value=theirs, candidate=ANOTHER_CANDIDATE
                ),
            )
            == "candidate_attribute_score_is_of_its_results_candidate"
        )

    def test_it_cannot_name_an_attribute_its_evaluation_did_not_freeze(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        """A reopened drill-down reads the frozen criterion's pillar, so this one would 500."""
        _evaluation, result = a_result_with_its_criterion

        assert (
            refused_by(
                connection,
                lambda: record_an_attribute_score(connection, result, attribute=ANOTHER_ATTRIBUTE),
            )
            == "candidate_attribute_score_names_a_frozen_criterion"
        )

    def test_it_cannot_borrow_another_evaluations_frozen_criterion(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        """What keeps the frozen-criterion key from being met by naming a snapshot that has it."""
        _evaluation, result = a_result_with_its_criterion
        elsewhere = record_an_evaluation(connection)
        record_a_frozen_criterion(connection, elsewhere)

        assert (
            refused_by(
                connection,
                lambda: record_an_attribute_score(connection, result, evaluation=elsewhere),
            )
            == "candidate_attribute_score_is_of_its_results_evaluation"
        )


def an_answer(connection: psycopg.Connection, candidate: str) -> int:
    """A gate-answer version for `candidate`."""
    row = connection.execute(
        "INSERT INTO match_rule_answer (match_rule, candidate, match_result, data_source, "
        "retrieval_date) VALUES (%s, %s, 'not_matching', 'manual', now()) RETURNING id",
        (A_GATE, candidate),
    ).fetchone()
    assert row is not None
    return int(row[0])


def a_compound_refusal(connection: psycopg.Connection, result: int, evaluation: int) -> None:
    record_a_non_match_reason(
        connection, result, evaluation=evaluation, attribute=None, compound_rule=A_COMPOUND_RULE
    )


def a_warning(connection: psycopg.Connection, result: int, _evaluation: int) -> None:
    connection.execute(
        "INSERT INTO candidate_warning (candidate_result, compound_rule, detail) "
        "VALUES (%s, %s, 'cheap and taxed')",
        (result, A_COMPOUND_RULE),
    )


class TestEvidenceNamesItsOwnCandidate:
    """ST-13's siblings (D4, `0523`): a refusal's figure or gate answer, a gate warning's answer,
    and a compound rule's input figures are all the result's own candidate's."""

    def test_a_threshold_refusal_cites_only_its_own_figure(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        evaluation, result = a_result_with_its_criterion
        ours = record_a_figure(connection)
        theirs = record_a_figure(connection, candidate=ANOTHER_CANDIDATE)

        def citing(figure: int) -> Callable[[], None]:
            return lambda: record_a_non_match_reason(
                connection, result, evaluation=evaluation, used_value=figure
            )

        assert (
            refused_by(connection, citing(theirs)) == "non_match_reason_cites_its_own_measurement"
        )
        assert refused_by(connection, citing(ours)) is None

    def test_a_gate_refusal_cites_only_its_own_candidates_answer(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        evaluation, result = a_result_with_its_criterion

        def citing(answer: int) -> Callable[[], None]:
            return lambda: record_a_non_match_reason(
                connection,
                result,
                evaluation=evaluation,
                attribute=None,
                match_rule=A_GATE,
                match_rule_answer=answer,
            )

        assert (
            refused_by(connection, citing(an_answer(connection, ANOTHER_CANDIDATE)))
            == "non_match_reason_cites_its_own_candidate_s_answer"
        )
        assert refused_by(connection, citing(an_answer(connection, A_SEEDED_CANDIDATE))) is None

    def test_a_gate_warning_cites_only_its_own_candidates_answer(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        _evaluation, result = a_result_with_its_criterion

        def citing(answer: int) -> Callable[[], None]:
            return lambda: connection.execute(
                "INSERT INTO candidate_gate_warning (candidate_result, candidate, match_rule, "
                "match_rule_answer, detail) "
                "SELECT id, candidate, %s, %s, 'held as a warning' FROM candidate_result "
                "WHERE id = %s",
                (A_GATE, answer, result),
            )

        assert (
            refused_by(connection, citing(an_answer(connection, ANOTHER_CANDIDATE)))
            == "candidate_gate_warning_cites_its_own_candidate_s_answer"
        )
        assert refused_by(connection, citing(an_answer(connection, A_SEEDED_CANDIDATE))) is None

    @pytest.mark.parametrize(
        ("table", "its_rule", "pin"),
        [
            (
                "candidate_warning_input",
                a_warning,
                "candidate_warning_input_cites_its_own_candidate_s_figure",
            ),
            (
                "non_match_input",
                a_compound_refusal,
                "non_match_input_cites_its_own_candidate_s_figure",
            ),
        ],
        ids=["warning", "refusal"],
    )
    def test_a_compound_rules_input_is_only_its_own_candidates_figure(
        self,
        connection: psycopg.Connection,
        a_result_with_its_criterion: tuple[int, int],
        table: str,
        its_rule: Callable[[psycopg.Connection, int, int], None],
        pin: str,
    ) -> None:
        evaluation, result = a_result_with_its_criterion
        its_rule(connection, result, evaluation)

        def citing(figure: int) -> Callable[[], None]:
            return lambda: connection.execute(
                f"INSERT INTO {table} (candidate_result, candidate, compound_rule, value_id, "
                "ordinal) SELECT id, candidate, %s, %s, 0 FROM candidate_result WHERE id = %s",
                (A_COMPOUND_RULE, figure, result),
            )

        assert (
            refused_by(connection, citing(record_a_figure(connection, candidate=ANOTHER_CANDIDATE)))
            == pin
        )
        assert refused_by(connection, citing(record_a_figure(connection))) is None

    def test_a_refusals_input_belongs_to_a_refusal_by_its_rule(
        self, connection: psycopg.Connection, a_result_with_its_criterion: tuple[int, int]
    ) -> None:
        """SV-N6: an input with no reason to explain was stored, and read by nothing."""
        _evaluation, result = a_result_with_its_criterion
        figure = record_a_figure(connection)

        assert (
            refused_by(
                connection,
                lambda: connection.execute(
                    "INSERT INTO non_match_input (candidate_result, candidate, compound_rule, "
                    "value_id, ordinal) VALUES (%s, %s, %s, %s, 0)",
                    (result, A_SEEDED_CANDIDATE, A_COMPOUND_RULE, figure),
                ),
            )
            == "non_match_input_belongs_to_a_refusal"
        )


def a_rule_at_the_nested_level(connection: psycopg.Connection, kind: str) -> str:
    """A gate or compound rule declared for cities, which the catalog does not ship."""
    if kind == "match_rule":
        connection.execute(
            "INSERT INTO match_rule (id, level, name, description) "
            "VALUES ('city_curfew', %s, 'A city gate', 'The city has no curfew.')",
            (THE_NESTED_LEVEL,),
        )
        return "city_curfew"
    connection.execute(
        "INSERT INTO compound_rule (id, name, level, shape, outcome) "
        "VALUES ('city_rule', 'A city rule', %s, 'AllConditionsHold', 'warning')",
        (THE_NESTED_LEVEL,),
    )
    return "city_rule"


def freeze_a_rule(
    connection: psycopg.Connection, kind: str, evaluation: int, rule: str, level: str | None
) -> None:
    outcome = "not_matching" if kind == "match_rule" else "warning"
    connection.execute(
        f"INSERT INTO evaluation_{kind} (evaluation, {kind}, level, outcome) "
        "VALUES (%s, %s, %s, %s)",
        (evaluation, rule, level, outcome),
    )


class TestTheFrozenSetSitsAtItsEvaluationsLevel:
    """ST-14 (`0523`): the frozen criteria, and the frozen rule lists where a rule has a level,
    are the set's slice at the evaluation's level."""

    @pytest.mark.parametrize(
        ("claimed", "pin"),
        [
            (THE_NESTED_LEVEL, "evaluation_criterion_judges_an_attribute_at_that_level"),
            (A_SEEDED_LEVEL, "evaluation_criterion_is_at_its_evaluations_level"),
        ],
        ids=["claiming the evaluation's level", "claiming the attribute's level"],
    )
    def test_a_country_criterion_cannot_be_frozen_into_a_city_evaluation(
        self, connection: psycopg.Connection, claimed: str, pin: str
    ) -> None:
        """Either level it claims, one of the two keys refuses it. Mutation: drop either key and
        its case stores, and a reopened city ranking 500s on a country pillar it never weighted."""
        evaluation = record_an_evaluation(connection, level=THE_NESTED_LEVEL)

        assert (
            refused_by(
                connection, lambda: record_a_frozen_criterion(connection, evaluation, level=claimed)
            )
            == pin
        )

    @pytest.mark.parametrize("kind", ["match_rule", "compound_rule"])
    def test_a_city_rule_cannot_be_frozen_into_a_country_evaluation(
        self, connection: psycopg.Connection, kind: str
    ) -> None:
        evaluation = record_an_evaluation(connection, level=A_SEEDED_LEVEL)
        rule = a_rule_at_the_nested_level(connection, kind)

        assert refused_by(
            connection, lambda: freeze_a_rule(connection, kind, evaluation, rule, A_SEEDED_LEVEL)
        ) == (f"evaluation_{kind}_is_a_{'gate' if kind == 'match_rule' else 'rule'}_at_that_level")
        assert (
            refused_by(
                connection,
                lambda: freeze_a_rule(connection, kind, evaluation, rule, THE_NESTED_LEVEL),
            )
            == f"evaluation_{kind}_is_at_its_evaluations_level"
        )

    def test_a_gate_asked_at_every_level_is_frozen_at_none(
        self, connection: psycopg.Connection
    ) -> None:
        """The control, and the residue the plan records: a rule with no level pins nothing."""
        evaluation = record_an_evaluation(connection, level=A_SEEDED_LEVEL)

        assert (
            refused_by(
                connection,
                lambda: freeze_a_rule(
                    connection, "match_rule", evaluation, A_GATE_AT_EVERY_LEVEL, None
                ),
            )
            is None
        )


def run_script(connection: psycopg.Connection, migration: Path) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        connection.execute(statement)


@pytest.fixture
def without_the_pins(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """The schema as `0523`'s rollback leaves it, inside a transaction always undone."""
    with connection.transaction(force_rollback=True):
        run_script(connection, THEIR_ROLLBACK)
        yield connection


class TestThePinsRefuseBeforeChangingAnything:
    def test_rows_they_would_break_are_named_and_nothing_is_keyed(
        self, without_the_pins: psycopg.Connection
    ) -> None:
        connection = without_the_pins
        evaluation = record_an_evaluation(connection)
        connection.execute(
            "INSERT INTO evaluation_criterion (evaluation, attribute, pillar, value_type, "
            "is_scored, weight, pillar_weight, goal, normalisation_method, blocks_if_missing, "
            "weight_locked) VALUES (%s, %s, 'economics', 'Quantity', true, 40, 30, 'minimise', "
            "'percentile', false, false)",
            (evaluation, A_SEEDED_ATTRIBUTE),
        )
        result = record_a_result(connection, evaluation)
        theirs = record_a_figure(connection, candidate=ANOTHER_CANDIDATE)
        connection.execute(
            "INSERT INTO candidate_attribute_score (candidate_result, attribute, used_value, "
            "effective_weight, contribution, score_scale_max) VALUES (%s, %s, %s, 40, 2.8, 10)",
            (result, A_SEEDED_ATTRIBUTE, theirs),
        )
        connection.execute(
            "INSERT INTO non_match_input (candidate_result, compound_rule, value_id, ordinal) "
            "VALUES (%s, %s, %s, 0)",
            (result, A_COMPOUND_RULE, theirs),
        )
        city_ranking = record_an_evaluation(connection, level=THE_NESTED_LEVEL)
        connection.execute(
            "INSERT INTO evaluation_criterion (evaluation, attribute, pillar, value_type, "
            "is_scored, weight, pillar_weight, goal, normalisation_method, blocks_if_missing, "
            "weight_locked) VALUES (%s, %s, 'economics', 'Quantity', true, 40, 30, 'minimise', "
            "'percentile', false, false)",
            (city_ranking, A_SEEDED_ATTRIBUTE),
        )

        with pytest.raises(errors.RaiseException) as refusal, connection.transaction():
            run_script(connection, THE_PINS)

        message = str(refusal.value)
        assert "a contribution citing a figure not its own: 1" in message
        assert f"result {result}, {A_SEEDED_ATTRIBUTE} cites value {theirs}" in message
        assert "a compound rule's input from another candidate: 1" in message
        assert "an input to a refusal its result does not hold: 1" in message
        assert f"result {result}, {A_COMPOUND_RULE}" in message
        assert "a frozen criterion at another level than its evaluation: 1" in message
        assert (
            f"evaluation {city_ranking} ({THE_NESTED_LEVEL}) froze {A_SEEDED_ATTRIBUTE}" in message
        )
        assert (
            connection.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = 'value_candidate_attribute_key'"
            ).fetchone()
            is None
        )

    def test_they_apply_again_after_their_rollback_and_copy_each_rows_parent(
        self, without_the_pins: psycopg.Connection
    ) -> None:
        """The round trip: what the rollback loosened is keyed again, and every copied column is
        its parent's -- the result's candidate and evaluation, the evaluation's level, the
        rule's own level."""
        connection = without_the_pins
        evaluation = record_an_evaluation(connection)
        connection.execute(
            "INSERT INTO evaluation_criterion (evaluation, attribute, pillar, value_type, "
            "is_scored, weight, pillar_weight, goal, normalisation_method, blocks_if_missing, "
            "weight_locked) VALUES (%s, %s, 'safety', 'Quantity', true, 40, 30, 'minimise', "
            "'percentile', false, false)",
            (evaluation, ANOTHER_ATTRIBUTE),
        )
        connection.execute(
            "INSERT INTO evaluation_match_rule (evaluation, match_rule) VALUES (%s, %s), (%s, %s)",
            (evaluation, A_GATE, evaluation, A_GATE_AT_EVERY_LEVEL),
        )
        result = record_a_result(connection, evaluation)
        ours = record_a_figure(connection, attribute=ANOTHER_ATTRIBUTE)
        connection.execute(
            "INSERT INTO candidate_attribute_score (candidate_result, attribute, used_value, "
            "effective_weight, contribution, score_scale_max) VALUES (%s, %s, %s, 40, 2.8, 10)",
            (result, ANOTHER_ATTRIBUTE, ours),
        )
        # `ALTER TABLE value` refuses while the figure's deferred payload check is pending, so
        # the figure gets its payload and the check runs now, as a commit would have run it.
        connection.execute(
            "INSERT INTO value_quantity (value_id, value_type, magnitude, unit) "
            "SELECT %s, 'Quantity', 1, unit FROM attribute_quantity_parameter WHERE attribute = %s",
            (ours, ANOTHER_ATTRIBUTE),
        )
        connection.execute("SET CONSTRAINTS ALL IMMEDIATE")

        run_script(connection, THE_PINS)

        connection.execute("SET CONSTRAINTS ALL DEFERRED")

        assert connection.execute(
            "SELECT evaluation, candidate FROM candidate_attribute_score "
            "WHERE candidate_result = %s",
            (result,),
        ).fetchall() == [(evaluation, A_SEEDED_CANDIDATE)]
        assert connection.execute(
            "SELECT level FROM evaluation_criterion WHERE evaluation = %s", (evaluation,)
        ).fetchall() == [(A_SEEDED_LEVEL,)]
        assert connection.execute(
            "SELECT match_rule, level FROM evaluation_match_rule WHERE evaluation = %s "
            "ORDER BY match_rule",
            (evaluation,),
        ).fetchall() == [(A_GATE, A_SEEDED_LEVEL), (A_GATE_AT_EVERY_LEVEL, None)]
        theirs = record_a_figure(
            connection, candidate=ANOTHER_CANDIDATE, attribute=ANOTHER_ATTRIBUTE
        )
        assert (
            refused_by(
                connection,
                lambda: connection.execute(
                    "UPDATE candidate_attribute_score SET used_value = %s "
                    "WHERE candidate_result = %s",
                    (theirs, result),
                ),
            )
            == "candidate_attribute_score_cites_its_own_measurement"
        )
