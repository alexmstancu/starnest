"""0509: the comparator limit is 1-20 in the database too (PL-030, D-C02-A option B).

A bound the API holds alone is a bound a second client, or a hand edit in `psql`, can step past
-- and the response model would then fail every settings read with a 500 (C02-S7). So the table
holds it as well. **A row already outside the range is refused by name**, never clamped: the
migration cannot know what the household meant by 25, and choosing for it would be this
application deciding a setting.

Each test runs the migration's own statements, as yoyo splits them, inside a transaction that is
always rolled back, so the session's database is left exactly as it was.
"""

from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0509-the-comparator-limit-is-one-to-twenty"
CONSTRAINT = "settings_comparator_limit_is_one_to_twenty"


def statements_of(file_name: str) -> list[str]:
    _directives, _leading_comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    return statements


def constraints_on_settings(connection: psycopg.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'settings'::regclass"
    ).fetchall()
    return {name for (name,) in rows}


def store_a_comparator_limit(connection: psycopg.Connection, limit: int) -> None:
    connection.execute(
        "INSERT INTO settings (id, comparator_limit) VALUES (1, %s)"
        " ON CONFLICT (id) DO UPDATE SET comparator_limit = EXCLUDED.comparator_limit",
        (limit,),
    )


def run(connection: psycopg.Connection, file_name: str) -> None:
    for statement in statements_of(file_name):
        connection.execute(statement)


def test_the_database_refuses_a_limit_above_twenty(connection: psycopg.Connection) -> None:
    with (
        pytest.raises(errors.CheckViolation, match=CONSTRAINT),
        connection.transaction(force_rollback=True),
    ):
        store_a_comparator_limit(connection, 21)


def test_a_stored_limit_outside_the_range_stops_the_migration_and_is_named(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        store_a_comparator_limit(connection, 25)

        with (
            pytest.raises(errors.RaiseException, match=r"comparator_limit.*\b25\b"),
            connection.transaction(),
        ):
            run(connection, f"{MIGRATION}.sql")

        assert CONSTRAINT not in constraints_on_settings(connection)


def test_a_stored_limit_inside_the_range_migrates_untouched(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        store_a_comparator_limit(connection, 20)

        run(connection, f"{MIGRATION}.sql")

        assert CONSTRAINT in constraints_on_settings(connection)
        stored = connection.execute("SELECT comparator_limit FROM settings").fetchone()
        assert stored == (20,)


def test_the_rollback_drops_only_the_ceiling(connection: psycopg.Connection) -> None:
    with connection.transaction(force_rollback=True):
        before = constraints_on_settings(connection)

        run(connection, f"{MIGRATION}.rollback.sql")

        assert before - constraints_on_settings(connection) == {CONSTRAINT}
        assert "settings_comparator_limit_is_positive" in constraints_on_settings(connection)
