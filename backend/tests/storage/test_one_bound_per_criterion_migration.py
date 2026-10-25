"""0520: a criterion carries one share bound and one label threshold at most (PL-169).

**A criterion already carrying several stops the migration and is named**, never resolved by
keeping one: which bound was meant is the household's to say. Each test runs the migration's own
statements, as yoyo splits them, inside a transaction that is always rolled back.
"""

from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0520-a-criterion-carries-one-bound-at-most"
CONSTRAINTS = {
    "criterion_threshold_share_one_per_criterion",
    "criterion_threshold_label_one_per_criterion",
}
A_SET = "one_bound_per_criterion"
A_LABELLED_ATTRIBUTE = "country.climate_zone"
A_COMPOSED_ATTRIBUTE = "country.one_bound_languages"


def run(connection: psycopg.Connection, file_name: str) -> None:
    _directives, _comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    for statement in statements:
        connection.execute(statement)


def one_per_criterion(connection: psycopg.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT conname FROM pg_constraint WHERE conname LIKE '%\\_one\\_per\\_criterion'"
    ).fetchall()
    return {name for (name,) in rows}


def judge_with_several_bounds(connection: psycopg.Connection) -> None:
    """A set judging a LabelSet with two labels and a ShareComposition with two bounds."""
    connection.execute("INSERT INTO criteria_set (id, name) VALUES (%s, %s)", (A_SET, A_SET))
    connection.execute(
        "INSERT INTO attribute (id, pillar, level, value_type, name)"
        " VALUES (%s, 'culture', 'country', 'ShareComposition', 'Languages spoken')",
        (A_COMPOSED_ATTRIBUTE,),
    )
    connection.execute(
        """
        INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                               goal, normalisation_method)
        SELECT %s, a.id, a.pillar, a.value_type, false, 10, 'maximise', 'as_is'
        FROM   attribute AS a WHERE a.id IN (%s, %s)
        """,
        (A_SET, A_LABELLED_ATTRIBUTE, A_COMPOSED_ATTRIBUTE),
    )
    connection.execute(
        """
        INSERT INTO criterion_threshold_label (criterion, value_type, label, containment_rule)
        SELECT c.id, c.value_type, bound.label, bound.rule
        FROM   criterion AS c,
               (VALUES ('Cfb', 'must_contain'), ('BWh', 'must_not_contain')) AS bound (label, rule)
        WHERE  c.criteria_set = %s AND c.attribute = %s
        """,
        (A_SET, A_LABELLED_ATTRIBUTE),
    )
    connection.execute(
        """
        INSERT INTO criterion_threshold_share (criterion, value_type, label, min_share)
        SELECT c.id, c.value_type, bound.label, 20
        FROM   criterion AS c, (VALUES ('English'), ('German')) AS bound (label)
        WHERE  c.criteria_set = %s AND c.attribute = %s
        """,
        (A_SET, A_COMPOSED_ATTRIBUTE),
    )


def test_a_criterion_with_several_bounds_stops_the_migration_and_is_named(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        run(connection, f"{MIGRATION}.rollback.sql")
        judge_with_several_bounds(connection)

        with pytest.raises(errors.RaiseException) as refusal, connection.transaction():
            run(connection, f"{MIGRATION}.sql")

        message = str(refusal.value)
        assert (
            f"{A_LABELLED_ATTRIBUTE} in set {A_SET} has 2 label thresholds "
            "(must_not_contain BWh, must_contain Cfb)"
        ) in message
        assert f"{A_COMPOSED_ATTRIBUTE} in set {A_SET} has 2 share bounds (on English, German)" in (
            message
        )
        assert one_per_criterion(connection) == set()
        kept = connection.execute(
            "SELECT (SELECT count(*) FROM criterion_threshold_label"
            "        JOIN criterion ON criterion.id = criterion WHERE criteria_set = %(set)s),"
            "       (SELECT count(*) FROM criterion_threshold_share"
            "        JOIN criterion ON criterion.id = criterion WHERE criteria_set = %(set)s)",
            {"set": A_SET},
        ).fetchone()
        assert kept == (2, 2), "the refusal chose a bound for the household"


def test_the_rollback_drops_the_two_constraints_and_the_migration_restores_them(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction(force_rollback=True):
        assert one_per_criterion(connection) == CONSTRAINTS

        run(connection, f"{MIGRATION}.rollback.sql")
        assert one_per_criterion(connection) == set()

        run(connection, f"{MIGRATION}.sql")
        assert one_per_criterion(connection) == CONSTRAINTS
