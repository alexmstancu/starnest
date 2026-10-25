"""0521: a converted amount names who published its rate (PL-170, D63).

**Backfilled through `0112`'s key**, so a conversion stored before 0521 comes out of it naming
the publisher of the rate it references. Each test runs the migration's own statements, as yoyo
splits them, inside a transaction that is always rolled back.
"""

from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0521-a-converted-amount-names-who-published-its-rate"
A_MONETARY_ATTRIBUTE = "country.rate_publisher_rent"


def run(connection: psycopg.Connection, file_name: str) -> None:
    _directives, _comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    for statement in statements:
        connection.execute(statement)


def a_conversion_stored_before_0521(connection: psycopg.Connection) -> int:
    """910 RON at the ECB's rate, written as the schema before 0521 held it: no publisher."""
    connection.execute(
        "INSERT INTO attribute (id, pillar, level, value_type, name)"
        " VALUES (%s, 'housing', 'country', 'Monetary', 'Rent')",
        (A_MONETARY_ATTRIBUTE,),
    )
    connection.execute(
        "INSERT INTO fx_rate (base_currency, quote_currency, rate_date, rate, data_source)"
        " VALUES ('RON', 'EUR', '2026-06-30', 0.201033, 'ecb')"
    )
    (value_id,) = connection.execute(
        """
        INSERT INTO value (candidate, attribute, value_type, data_source, reference_period_start,
                           reference_period_end, retrieval_date, confidence_level)
        VALUES ('country.romania', %s, 'Monetary', 'manual', '2026-01-01', '2026-12-31', now(),
                'medium')
        RETURNING id
        """,
        (A_MONETARY_ATTRIBUTE,),
    ).fetchone()
    connection.execute(
        "INSERT INTO value_monetary (value_id, value_type, amount, currency, amount_eur,"
        " fx_rate, fx_rate_date) VALUES (%s, 'Monetary', 910, 'RON', 182.94, 0.201033,"
        " '2026-06-30')",
        (value_id,),
    )
    return value_id


def test_a_conversion_stored_before_it_names_the_publisher_of_its_rate(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        value_id = a_conversion_stored_before_0521(connection)

        run(connection, f"{MIGRATION}.sql")

        assert connection.execute(
            "SELECT fx_rate_source FROM value_monetary WHERE value_id = %s", (value_id,)
        ).fetchone() == ("ecb",)


def test_the_rollback_restores_0112s_key_under_its_own_name(
    connection: psycopg.Connection,
) -> None:
    """`0112`'s rollback drops its key by name, so 0521's rollback must give that name back."""
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        value_id = a_conversion_stored_before_0521(connection)

        named = connection.execute(
            "SELECT conname FROM pg_constraint WHERE conrelid = 'value_monetary'::regclass"
            " AND contype = 'f' AND conname LIKE '%rate%'"
        ).fetchall()
        assert named == [("value_monetary_rate_is_one_that_was_published",)]
        with pytest.raises(errors.ForeignKeyViolation), connection.transaction():
            connection.execute(
                "UPDATE value_monetary SET fx_rate = 0.18, amount_eur = 163.80 WHERE value_id = %s",
                (value_id,),
            )
