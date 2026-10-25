"""0522: an outside opinion names the series it is an edition of (PL-171, D64).

**A stored outside opinion stops the migration and is named**: nothing says which series it
belongs to, and the migration will not guess. Each test runs the migration's own statements, as
yoyo splits them, inside a transaction that is always rolled back.
"""

from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0522-an-outside-opinion-names-its-series"


def run(connection: psycopg.Connection, file_name: str) -> None:
    _directives, _comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    for statement in statements:
        connection.execute(statement)


def has_series(connection: psycopg.Connection) -> bool:
    return connection.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns"
        " WHERE table_name = 'external_score' AND column_name = 'series')"
    ).fetchone() == (True,)


def test_a_stored_outside_opinion_stops_the_migration_and_is_named(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        connection.execute(
            "INSERT INTO external_score (candidate, data_source, published_value,"
            " published_scale, reference_period_start, reference_period_end, retrieval_date)"
            " VALUES ('country.portugal', 'numbeo', 72.4, '0-100', '2026-01-01', '2026-12-31',"
            " now())"
        )

        with pytest.raises(errors.RaiseException) as refusal, connection.transaction():
            run(connection, f"{MIGRATION}.sql")

        assert "country.portugal by numbeo for 2026-01-01 to 2026-12-31" in str(refusal.value)
        assert not has_series(connection)


def test_the_rollback_refuses_while_two_series_would_collide(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        connection.execute(
            "INSERT INTO external_score (candidate, data_source, series, published_value,"
            " published_scale, reference_period_start, reference_period_end, retrieval_date)"
            " SELECT 'country.portugal', 'numbeo', series, 72.4, '0-100', '2026-01-01',"
            " '2026-12-31', '2026-08-01T00:00:00Z'"
            " FROM (VALUES ('Crime Index'), ('Quality of Life Index')) AS named (series)"
        )

        with pytest.raises(errors.RaiseException) as refusal, connection.transaction():
            run(connection, f"{MIGRATION}.rollback.sql")

        assert "series Crime Index, Quality of Life Index" in str(refusal.value)
        assert has_series(connection)


def test_the_rollback_drops_the_series_and_the_migration_restores_it(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        assert not has_series(connection)

        run(connection, f"{MIGRATION}.sql")
        assert has_series(connection)
