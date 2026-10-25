"""0518: every number the domain reads is finite in the database (PL-167: ST-16, IN-NAN).

The domain refuses NaN and both infinities on read, so a non-finite figure stored by any other
route answers 500 on every screen that reads it. PostgreSQL sorts NaN above every number, which
makes `x >= 0` and `x > 0` true for NaN, and `numeric` has held +-Infinity since version 14: a
sign or order check is no finite check. So every numeric column carries one, or a bound on both
sides that refuses all three as surely -- and **the guard below reads every numeric column in
the schema**, so a column added later without either fails here.

A check is judged by evaluating its own expression over a row holding only the column under
test, which is exactly how a CHECK decides: refused means the expression is false.
"""

from pathlib import Path

import psycopg
import pytest
from psycopg import errors, sql
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0518-every-figure-the-domain-reads-is-finite"
NON_FINITE = ("NaN", "Infinity", "-Infinity")

#: The two checks 0006 named before the `<table>_<column>_is_finite` rule, kept by 0518.
NAMED_BEFORE_THE_RULE = {("value_monetary", "amount_eur"): "value_monetary_eur_is_finite"}

#: Columns with no `_is_finite` check, each with the check that refuses non-finite figures for it
#: and why that is enough. A bound on both sides refuses NaN (NaN <= 100 is false) and both
#: infinities, so a finite check beside it would only restate it.
EXEMPT = {
    ("value_ratio", "value"): ("value_ratio_is_a_percentage", "a percentage, 0 to 100"),
    ("value_sharecomp", "share"): ("value_sharecomp_share_is_a_percentage", "a share, 0 to 100"),
    ("settings", "min_coverage"): ("settings_coverage_is_a_percentage", "a percentage"),
    ("pillar_weight", "weight"): ("pillar_weight_is_a_percentage", "a weight, 0 to 100"),
    ("criterion", "weight"): ("criterion_weight_is_a_percentage", "a weight, 0 to 100"),
    ("criterion_threshold_share", "min_share"): (
        "criterion_threshold_share_is_a_percentage",
        "a bound on a share, 0 to 100",
    ),
    ("criterion_threshold_share", "max_share"): (
        "criterion_threshold_share_is_a_percentage",
        "a bound on a share, 0 to 100",
    ),
    ("evaluation_criterion", "weight"): (
        "evaluation_criterion_weights_are_percentages",
        "a frozen weight, 0 to 100",
    ),
    ("evaluation_criterion", "pillar_weight"): (
        "evaluation_criterion_weights_are_percentages",
        "a frozen pillar weight, 0 to 100",
    ),
    ("candidate_result", "coverage"): (
        "candidate_result_coverage_is_a_percentage",
        "a percentage of the weight",
    ),
    **{
        ("candidate_result", column): (
            "candidate_result_confidence_shares_are_percentages",
            "a percentage of the weight",
        )
        for column in ("coverage_absolute", "coverage_high", "coverage_medium", "coverage_low")
    },
    ("candidate_attribute_score", "effective_weight"): (
        "candidate_attribute_score_weight_is_a_percentage",
        "a weight, 0 to 100",
    ),
    ("population_centre", "latitude"): (
        "population_centre_is_on_the_globe",
        "a latitude, -90 to 90",
    ),
    ("population_centre", "longitude"): (
        "population_centre_is_on_the_globe",
        "a longitude, -180 to 180",
    ),
}


def numeric_columns(connection: psycopg.Connection) -> list[tuple[str, str]]:
    rows = connection.execute(
        "SELECT table_name, column_name FROM information_schema.columns"
        " JOIN information_schema.tables USING (table_schema, table_name)"
        " WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        "   AND data_type IN ('numeric', 'double precision', 'real')"
        " ORDER BY 1, 2"
    ).fetchall()
    return [(table, column) for table, column in rows]


def finite_check_of(table: str, column: str) -> str:
    if (table, column) in EXEMPT:
        return EXEMPT[(table, column)][0]
    return NAMED_BEFORE_THE_RULE.get((table, column), f"{table}_{column}_is_finite")


def refuses(connection: psycopg.Connection, check: str, column: str, figure: str) -> bool:
    """Whether `check` refuses a row whose `column` is `figure` and every other column NULL.

    A column whose declared precision cannot hold the figure at all -- `numeric(8,5)` has no
    room for an infinity -- refuses it before any check is asked.
    """
    found = connection.execute(
        "SELECT pg_get_expr(conbin, conrelid), conrelid FROM pg_constraint"
        " WHERE conname = %s AND contype = 'c'",
        (check,),
    ).fetchone()
    assert found is not None, f"there is no check called {check}"
    expression, table = found
    columns = connection.execute(
        "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute"
        " WHERE attrelid = %s AND attnum > 0 AND NOT attisdropped",
        (table,),
    ).fetchall()
    row = sql.SQL(", ").join(
        sql.SQL("{}::{} AS {}").format(
            sql.Literal(figure if name == column else None), sql.SQL(type_), sql.Identifier(name)
        )
        for name, type_ in columns
    )
    query = sql.SQL("SELECT ({}) FROM (SELECT {}) AS row_under_test").format(
        sql.SQL(expression), row
    )
    try:
        with connection.transaction():
            (verdict,) = connection.execute(query).fetchone()
    except errors.NumericValueOutOfRange:
        return True
    return verdict is False


def test_the_guard_reads_the_columns_it_means_to(connection: psycopg.Connection) -> None:
    """Guards the test below, which a query that matched nothing would pass silently."""
    columns = numeric_columns(connection)

    assert len(columns) >= 50
    assert set(EXEMPT) <= set(columns), "an exemption names a column that is not numeric"


def test_every_numeric_column_refuses_every_non_finite_figure(
    connection: psycopg.Connection,
) -> None:
    unguarded = [
        f"{table}.{column} ({figure}, by {finite_check_of(table, column)})"
        for table, column in numeric_columns(connection)
        for figure in NON_FINITE
        if not refuses(connection, finite_check_of(table, column), column, figure)
    ]

    assert unguarded == [], (
        "these numeric columns accept a non-finite figure the domain cannot read. Add a "
        "`<table>_<column>_is_finite` check, or exempt the column with the bound that refuses "
        f"it: {unguarded}"
    )


def test_every_numeric_column_accepts_a_finite_figure(connection: psycopg.Connection) -> None:
    """The control: a finite check that refused everything would pass the test above."""
    refused = [
        f"{table}.{column}"
        for table, column in numeric_columns(connection)
        if refuses(
            connection,
            finite_check_of(table, column),
            column,
            "50" if (table, column) in EXEMPT else "1e30",
        )
    ]

    assert refused == []


def test_the_database_refuses_an_infinite_figure_on_write(connection: psycopg.Connection) -> None:
    with (
        pytest.raises(errors.CheckViolation, match="settings_run_spend_cap_eur_is_finite"),
        connection.transaction(force_rollback=True),
    ):
        connection.execute("INSERT INTO settings (id, run_spend_cap_eur) VALUES (1, 'Infinity')")


def run(connection: psycopg.Connection, file_name: str) -> None:
    _directives, _comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    for statement in statements:
        connection.execute(statement)


def finite_checks(connection: psycopg.Connection) -> dict[str, str]:
    rows = connection.execute(
        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint"
        " WHERE conname LIKE '%\\_is\\_finite' AND contype = 'c'"
    ).fetchall()
    return dict(rows)


def test_a_stored_non_finite_figure_stops_the_migration_and_is_named(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        connection.execute("INSERT INTO settings (id, run_spend_cap_eur) VALUES (1, 'Infinity')")
        connection.execute(
            "INSERT INTO fx_rate (base_currency, quote_currency, rate_date, rate, data_source)"
            " VALUES ('GBP', 'EUR', '2026-10-01', 'NaN', 'ecb')"
        )
        before = finite_checks(connection)

        with (
            pytest.raises(errors.RaiseException) as refusal,
            connection.transaction(),
        ):
            run(connection, f"{MIGRATION}.sql")

        message = str(refusal.value)
        assert "fx_rate.rate (GBP/EUR on 2026-10-01)" in message
        assert "settings.run_spend_cap_eur (id 1)" in message
        assert finite_checks(connection) == before


def test_the_rollback_leaves_the_three_old_checks_refusing_nan_alone(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")

        assert set(finite_checks(connection)) == {
            "value_monetary_amount_is_finite",
            "value_monetary_eur_is_finite",
            "value_quantity_magnitude_is_finite",
        }
        assert refuses(connection, "value_quantity_magnitude_is_finite", "magnitude", "NaN")
        assert not refuses(
            connection, "value_quantity_magnitude_is_finite", "magnitude", "Infinity"
        )


def test_the_migration_applies_again_after_its_rollback(connection: psycopg.Connection) -> None:
    with connection.transaction(force_rollback=True):
        applied = finite_checks(connection)

        run(connection, f"{MIGRATION}.rollback.sql")
        run(connection, f"{MIGRATION}.sql")

        assert finite_checks(connection) == applied
