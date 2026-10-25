"""When `0517`'s way back refuses (PL-164 review).

`0517` keeps the citizenships each gate answer assumed, and a saved ranking's refusals decided by
citizenship. Rolling it back would drop both, so it refuses while either exists -- and goes
quietly when neither does, taking only its own catalog seed.

Run inside one transaction that is always rolled back, after `0526`'s way back, as a descending
`make rollback` reaches `0517`.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
ITS_ROLLBACK = MIGRATIONS / "0517-citizenship-clears-the-gates-it-names.rollback.sql"
A_LATER_ROLLBACK = MIGRATIONS / "0526-a-clearing-citizenship-may-name-where-it-clears.rollback.sql"


def _run(connection: psycopg.Connection, migration: Path) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        connection.execute(statement)


@pytest.fixture
def after_0526_is_undone(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        _run(connection, A_LATER_ROLLBACK)
        yield connection


def _an_answer_that_assumed(connection: psycopg.Connection, citizenship: str) -> None:
    (answer,) = connection.execute(
        "INSERT INTO match_rule_answer (match_rule, candidate, match_result, data_source, "
        "retrieval_date) VALUES ('uk_skilled_worker', 'country.united_kingdom', 'not_matching', "
        "'manual', now()) RETURNING id"
    ).fetchone()
    connection.execute(
        "INSERT INTO match_rule_answer_citizenship (answer, citizenship) VALUES (%s, %s)",
        (answer, citizenship),
    )


def test_it_refuses_while_an_answer_s_assumed_citizenships_are_kept(
    after_0526_is_undone: psycopg.Connection,
) -> None:
    connection = after_0526_is_undone
    _an_answer_that_assumed(connection, "country.romania")

    with (
        pytest.raises(errors.RaiseException, match="cannot roll back 0517: 1 gate answer"),
        connection.transaction(),
    ):
        _run(connection, ITS_ROLLBACK)

    assert (
        connection.execute("SELECT to_regclass('match_rule_clearing_citizenship')").fetchone()[0]
        is not None
    )


def test_it_goes_quietly_when_nothing_recorded_depends_on_it(
    after_0526_is_undone: psycopg.Connection,
) -> None:
    """The control: the refusal above is the guard speaking, not the harness failing."""
    connection = after_0526_is_undone

    _run(connection, ITS_ROLLBACK)

    assert connection.execute(
        "SELECT to_regclass('match_rule_clearing_citizenship')"
    ).fetchone() == (None,)
