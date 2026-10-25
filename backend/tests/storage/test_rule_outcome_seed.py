"""What `0516` seeds when it makes each rule's outcome per set, and what its rollback refuses
(PL-157, D56).

Run inside one transaction that is always rolled back: the migration's rollback, then its own
statements, each in its own savepoint.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0516-a-set-holds-each-rule-as-a-gate-or-a-warning.sql"
ITS_ROLLBACK = THE_MIGRATION.with_name(f"{THE_MIGRATION.stem}.rollback.sql")


def _apply_until_refused(connection: psycopg.Connection, migration: Path) -> psycopg.Error | None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        try:
            with connection.transaction():
                connection.execute(statement)
        except psycopg.Error as refusal:
            return refusal
    return None


@pytest.fixture
def in_a_transaction(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        yield connection


def test_every_rule_a_set_turns_on_keeps_doing_what_it_did(
    in_a_transaction: psycopg.Connection,
) -> None:
    """A gate stays a gate and a compound rule keeps its catalog outcome, so no ranking moves;
    a row still carrying a false flag holds no outcome at all."""
    connection = in_a_transaction
    connection.execute(
        "INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied, outcome) "
        "VALUES ('minimal', 'cheap_but_taxed', true, 'warning')"
    )
    assert _apply_until_refused(connection, ITS_ROLLBACK) is None
    connection.execute(
        "INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced) "
        "VALUES ('minimal', 'uk_skilled_worker', true), ('minimal', 'li_eea_quota', false)"
    )

    assert _apply_until_refused(connection, THE_MIGRATION) is None

    gates = connection.execute(
        "SELECT match_rule, outcome FROM criteria_set_match_rule "
        "WHERE criteria_set = 'minimal' ORDER BY match_rule"
    ).fetchall()
    rules = connection.execute(
        "SELECT applied.outcome = rule.outcome FROM criteria_set_compound_rule AS applied "
        "JOIN compound_rule AS rule ON rule.id = applied.compound_rule "
        "WHERE applied.criteria_set = 'minimal'"
    ).fetchall()
    assert gates == [("li_eea_quota", None), ("uk_skilled_worker", "not_matching")]
    assert rules == [(True,)]


def test_an_outcome_for_a_rule_that_is_off_is_refused(in_a_transaction: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        in_a_transaction.execute(
            "INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced, outcome) "
            "VALUES ('minimal', 'uk_skilled_worker', false, 'warning')"
        )


def test_the_rollback_refuses_while_a_saved_ranking_froze_a_gate_held_as_a_warning(
    in_a_transaction: psycopg.Connection,
) -> None:
    connection = in_a_transaction
    saved = connection.execute(
        "INSERT INTO evaluation (criteria_set, level, computed_at, score_scale_max)"
        " VALUES ('minimal', 'country', now(), 100) RETURNING id"
    ).fetchone()
    assert saved is not None
    connection.execute(
        "INSERT INTO evaluation_match_rule (evaluation, match_rule, outcome)"
        " VALUES (%s, 'uk_skilled_worker', 'warning')",
        (saved[0],),
    )

    refusal = _apply_until_refused(connection, ITS_ROLLBACK)

    assert refusal is not None
    assert "cannot roll back 0516: 0 criteria set rule(s) and 1 saved-ranking row(s)" in str(
        refusal
    )
