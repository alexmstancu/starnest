"""Rollbacks refuse rather than overwrite weights a person changed, and address every set
(TL-N5, TL-N6).

Each rollback here writes weights as literals, right only while the pillar stands as its
migration left it. Run by yoyo itself, at each migration's own revision, on a private database
copied from one built once to the earliest of them.
"""

from collections.abc import Iterator
from dataclasses import dataclass

import psycopg
import pytest

from .private_database import apply_through, private_database, run_yoyo

pytestmark = pytest.mark.storage


@dataclass(frozen=True)
class Edit:
    migration: str
    edit: str
    names: str


MOVE = "UPDATE criterion SET weight = weight + 1 WHERE criteria_set = '{}' AND attribute = '{}'"

EDITS = (
    Edit(
        "0441-health-joins-the-minimal-set",
        "UPDATE pillar_weight SET weight_locked = true "
        "WHERE criteria_set = 'minimal' AND pillar = 'health'",
        "(minimal)",
    ),
    Edit(
        "0463-working-hours-and-networks-join-the-minimal-set",
        MOVE.format("minimal", "country.tech_employment_share"),
        "(minimal)",
    ),
    Edit(
        "0467-summer-and-winter-days-scored",
        MOVE.format("local_employment", "country.climate_zone"),
        "(local_employment)",
    ),
    Edit(
        "0471-european-air-is-descriptive",
        MOVE.format("remote_only", "country.broadband_coverage"),
        "(remote_only)",
    ),
    Edit(
        "0476-statutory-leave-is-descriptive",
        MOVE.format("local_employment", "country.international_employers"),
        "(local_employment)",
    ),
    Edit(
        "0477-career-weights-sum-exactly",
        MOVE.format("remote_only", "country.tech_product_jobs")
        + "; "
        + MOVE.format("local_employment", "country.tech_product_jobs"),
        "(local_employment, remote_only)",
    ),
    Edit(
        "0487-career-is-measured-by-the-workforce-that-exists",
        "UPDATE criterion SET weight_locked = true "
        "WHERE criteria_set = 'remote_only' AND attribute = 'country.tech_employment_share'",
        "(remote_only)",
    ),
)


@pytest.fixture(scope="module")
def earliest(database_url: str) -> Iterator[str]:
    with private_database(database_url, "weights_base", revision=EDITS[0].migration) as url:
        yield url


@pytest.fixture
def at_revision(earliest: str, database_url: str) -> Iterator[str]:
    with private_database(database_url, "weights_case", template=earliest) as url:
        yield url


def newest_applied(url: str) -> str:
    with psycopg.connect(url) as connection:
        row = connection.execute("SELECT max(migration_id) FROM _yoyo_migration").fetchone()
        assert row is not None
        return row[0]


@pytest.mark.parametrize("case", EDITS, ids=lambda case: case.migration[:4])
def test_a_rollback_refuses_to_overwrite_a_weight_a_person_changed_and_names_the_sets(
    case: Edit, at_revision: str
) -> None:
    apply_through(case.migration, database=at_revision)
    with psycopg.connect(at_revision) as connection:
        connection.execute(case.edit)

    done = run_yoyo("rollback", "--revision", case.migration, database=at_revision)

    assert done.returncode != 0
    assert f"cannot roll back {case.migration[:4]}" in done.stderr
    assert case.names in done.stderr
    assert newest_applied(at_revision) == case.migration


def test_0442_gives_every_set_judging_the_homicide_rate_its_crime_index_back(
    at_revision: str,
) -> None:
    migration = "0442-crime-splits-into-a-rate-and-a-composite"
    apply_through(migration, database=at_revision)
    with psycopg.connect(at_revision) as connection:
        a_copy_of("local_employment", "copied", connection)

    done = run_yoyo("rollback", "--revision", migration, database=at_revision)

    assert done.returncode == 0, done.stderr
    with psycopg.connect(at_revision) as connection:
        judged = connection.execute(
            "SELECT criteria_set FROM criterion "
            "WHERE attribute = 'country.crime_safety_index' ORDER BY 1"
        ).fetchall()
    assert judged == [("copied",), ("local_employment",)]


def test_0467_refuses_while_another_set_judges_the_daytime_temperatures(
    at_revision: str,
) -> None:
    migration = "0467-summer-and-winter-days-scored"
    apply_through(migration, database=at_revision)
    with psycopg.connect(at_revision) as connection:
        a_copy_of("local_employment", "copied", connection)

    done = run_yoyo("rollback", "--revision", migration, database=at_revision)

    assert done.returncode != 0
    assert "cannot roll back 0467: criteria set(s) (copied) also judge" in done.stderr


def test_0487_passes_over_a_shipped_set_that_was_deleted(at_revision: str) -> None:
    migration = "0487-career-is-measured-by-the-workforce-that-exists"
    apply_through(migration, database=at_revision)
    with psycopg.connect(at_revision) as connection:
        for statement in (
            "DELETE FROM criterion_scale_anchor WHERE criterion IN "
            "(SELECT id FROM criterion WHERE criteria_set = 'remote_only')",
            "DELETE FROM criterion_threshold_range WHERE criterion IN "
            "(SELECT id FROM criterion WHERE criteria_set = 'remote_only')",
            "DELETE FROM criterion WHERE criteria_set = 'remote_only'",
            "DELETE FROM pillar_weight WHERE criteria_set = 'remote_only'",
            "DELETE FROM criteria_set_match_rule WHERE criteria_set = 'remote_only'",
            "DELETE FROM criteria_set_compound_rule WHERE criteria_set = 'remote_only'",
            "DELETE FROM criteria_set WHERE id = 'remote_only'",
        ):
            connection.execute(statement)

    done = run_yoyo("rollback", "--revision", migration, database=at_revision)

    assert done.returncode == 0, done.stderr
    with psycopg.connect(at_revision) as connection:
        restored = connection.execute(
            "SELECT criteria_set, sum(weight) FROM criterion WHERE pillar = 'career' "
            "AND criteria_set = 'local_employment' GROUP BY 1"
        ).fetchall()
    assert restored == [("local_employment", 100)]


def a_copy_of(original: str, copy: str, connection: psycopg.Connection) -> None:
    """A duplicated set, as the application makes one: the set, its pillars and criteria."""
    connection.execute(
        "INSERT INTO criteria_set SELECT (jsonb_populate_record(NULL::criteria_set, "
        "to_jsonb(s) || jsonb_build_object('id', %(copy)s::text, 'name', %(copy)s::text))).* "
        "FROM criteria_set AS s WHERE id = %(original)s",
        {"copy": copy, "original": original},
    )
    for table in ("pillar_weight", "criterion"):
        columns = [
            row[0]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = %s AND column_name NOT IN ('criteria_set', 'id') "
                "ORDER BY ordinal_position",
                (table,),
            )
        ]
        listed = ", ".join(columns)
        connection.execute(
            f"INSERT INTO {table} (criteria_set, {listed}) "
            f"SELECT %s::text, {listed} FROM {table} WHERE criteria_set = %s",
            (copy, original),
        )
