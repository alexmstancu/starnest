"""What `0514` refuses before it ties a gate's concerned candidates to its level (PL-149, NEW-64).

The foreign keys would refuse an offending row too, but with a key violation naming a constraint.
The migration checks first and names every offending pair at once, so whoever reads the refusal
knows which rows to correct.

**Run against the database as the migration before it left it**, inside one transaction that is
always rolled back: the migration's rollback first, then the row that must be refused, then the
migration's own statements, each in its own savepoint.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

from .evaluation_rows import record_a_city

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0514-a-gate-concerns-only-candidates-at-its-level.sql"
ITS_ROLLBACK = THE_MIGRATION.with_name(f"{THE_MIGRATION.stem}.rollback.sql")

THE_SHIPPED_PAIRS = [
    ("ch_eu_efta_quota", "country.switzerland", "country"),
    ("li_eea_quota", "country.liechtenstein", "country"),
    ("uk_skilled_worker", "country.united_kingdom", "country"),
]


def _statements(migration: Path) -> list[str]:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    return statements


def _apply_until_refused(
    connection: psycopg.Connection, statements: list[str]
) -> psycopg.Error | None:
    for statement in statements:
        try:
            with connection.transaction():
                connection.execute(statement)
        except psycopg.Error as refusal:
            return refusal
    return None


def _the_level_is_kept(connection: psycopg.Connection) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'match_rule_candidate' AND column_name = 'level'"
        ).fetchone()
        is not None
    )


@pytest.fixture
def before_the_migration(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        assert _apply_until_refused(connection, _statements(ITS_ROLLBACK)) is None
        assert not _the_level_is_kept(connection)
        yield connection


def _concern(connection: psycopg.Connection, gate: str, candidate: str) -> None:
    connection.execute(
        "INSERT INTO match_rule_candidate (match_rule, candidate) VALUES (%s, %s)",
        (gate, candidate),
    )


def test_the_shipped_pairs_survive_at_their_gate_s_level(
    before_the_migration: psycopg.Connection,
) -> None:
    """The control: the shipped catalog passes the check, and each pair takes its gate's level."""
    connection = before_the_migration

    assert _apply_until_refused(connection, _statements(THE_MIGRATION)) is None
    assert (
        connection.execute(
            "SELECT match_rule, candidate, level FROM match_rule_candidate ORDER BY match_rule"
        ).fetchall()
        == THE_SHIPPED_PAIRS
    )


def test_a_city_listed_for_a_country_gate_is_refused_by_name_before_anything_changes(
    before_the_migration: psycopg.Connection,
) -> None:
    connection = before_the_migration
    record_a_city(connection, city="city.portugal.porto", country="country.portugal")
    _concern(connection, "uk_skilled_worker", "city.portugal.porto")

    refusal = _apply_until_refused(connection, _statements(THE_MIGRATION))

    assert isinstance(refusal, errors.RaiseException), f"not refused by the check: {refusal!r}"
    assert "uk_skilled_worker for city.portugal.porto" in str(refusal)
    assert not _the_level_is_kept(connection)


def test_a_row_for_a_gate_with_no_level_is_refused_by_name(
    before_the_migration: psycopg.Connection,
) -> None:
    """D55: every offender is named at once, this one beside the city."""
    connection = before_the_migration
    record_a_city(connection, city="city.portugal.porto", country="country.portugal")
    _concern(connection, "uk_skilled_worker", "city.portugal.porto")
    _concern(connection, "not_manually_excluded", "country.portugal")

    refusal = _apply_until_refused(connection, _statements(THE_MIGRATION))

    assert isinstance(refusal, errors.RaiseException), f"not refused by the check: {refusal!r}"
    assert "not_manually_excluded for country.portugal" in str(refusal)
    assert "uk_skilled_worker for city.portugal.porto" in str(refusal)
    assert not _the_level_is_kept(connection)
