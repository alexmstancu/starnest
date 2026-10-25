"""What `0515` refuses before it makes every gate say what it tests (PL-155, D57).

The description is NOT NULL, so a gate the migration has no text for would fail the constraint
with a bare violation. The migration checks first and names every such gate, so the author of
the gate knows to write its description rather than hunt for a column.

Run inside one transaction that is always rolled back: the migration's rollback, the gate it
must refuse, then its own statements, each in its own savepoint.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0515-every-gate-says-what-it-tests.sql"
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


def _gates_are_described(connection: psycopg.Connection) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'match_rule' AND column_name = 'description'"
        ).fetchone()
        is not None
    )


@pytest.fixture
def before_the_migration(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        assert _apply_until_refused(connection, ITS_ROLLBACK) is None
        assert not _gates_are_described(connection)
        yield connection


def test_every_shipped_gate_is_described(before_the_migration: psycopg.Connection) -> None:
    """The control: the shipped catalog passes, and no gate is left blank."""
    connection = before_the_migration

    assert _apply_until_refused(connection, THE_MIGRATION) is None
    assert (
        connection.execute(
            "SELECT id FROM match_rule WHERE btrim(description) = '' ORDER BY id"
        ).fetchall()
        == []
    )
    assert connection.execute(
        "SELECT description FROM match_rule WHERE id = 'not_manually_excluded'"
    ).fetchone() == ("You have not ruled this candidate out by hand.",)


def test_a_gate_with_no_description_is_refused_by_name_before_anything_changes(
    before_the_migration: psycopg.Connection,
) -> None:
    connection = before_the_migration
    connection.execute(
        "INSERT INTO match_rule (id, level, name) VALUES ('city_curfew', 'city', 'Curfew')"
    )

    refusal = _apply_until_refused(connection, THE_MIGRATION)

    assert isinstance(refusal, errors.RaiseException), f"not refused by the check: {refusal!r}"
    assert "city_curfew" in str(refusal)
    assert not _gates_are_described(connection)


def test_a_blank_description_is_refused(before_the_migration: psycopg.Connection) -> None:
    connection = before_the_migration
    assert _apply_until_refused(connection, THE_MIGRATION) is None

    with pytest.raises(errors.CheckViolation), connection.transaction():
        connection.execute(
            "UPDATE match_rule SET description = '  ' WHERE id = 'not_manually_excluded'"
        )
