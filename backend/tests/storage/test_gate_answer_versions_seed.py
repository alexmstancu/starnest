"""What `0511` makes of the gate answers already stored, and when its way back refuses (PL-143).

Run inside one transaction that is always rolled back: the rollback's statements take the schema
back to before `0511`, a live answer is written the old way, and `0511` is applied over it -- so
the backfill is asserted on a row it really had to copy, not read off the file.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0511-a-gate-answer-is-kept-once-written.sql"
ITS_ROLLBACK = THE_MIGRATION.with_name(f"{THE_MIGRATION.stem}.rollback.sql")

GATE = "uk_skilled_worker"
CANDIDATE = "country.united_kingdom"
PAGES = ["https://www.gov.uk/a", "https://www.gov.uk/b"]
CHECKED = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def _run(connection: psycopg.Connection, migration: Path) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        connection.execute(statement)


@pytest.fixture
def before_it(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """The schema as `0509` left it, holding one live answer with two pages. Always rolled back.

    `force_rollback` is what keeps it a test: `transaction()` on an idle connection begins one
    and would commit it.
    """
    with connection.transaction(force_rollback=True):
        _run(connection, ITS_ROLLBACK)
        connection.execute(
            "INSERT INTO match_rule_result (match_rule, candidate, match_result, reason, "
            "data_source, retrieval_date, override_reason, override_date) "
            "VALUES (%s, %s, 'not_matching', 'no sponsor', 'manual', %s, 'checked', %s)",
            (GATE, CANDIDATE, CHECKED, CHECKED),
        )
        for page in PAGES:
            connection.execute(
                "INSERT INTO match_rule_result_citation (match_rule, candidate, url) "
                "VALUES (%s, %s, %s)",
                (GATE, CANDIDATE, page),
            )
        yield connection


def test_each_live_answer_becomes_the_version_it_points_at_with_its_pages(
    before_it: psycopg.Connection,
) -> None:
    connection = before_it

    _run(connection, THE_MIGRATION)

    versions = connection.execute(
        "SELECT v.id, v.match_result, v.reason, v.data_source, v.retrieval_date, "
        "v.override_reason, v.override_date, v.recorded_at, "
        "ARRAY(SELECT c.url FROM match_rule_answer_citation AS c WHERE c.answer = v.id "
        "      ORDER BY c.url) "
        "FROM match_rule_answer AS v WHERE v.match_rule = %s AND v.candidate = %s",
        (GATE, CANDIDATE),
    ).fetchall()
    (live,) = connection.execute(
        "SELECT answer FROM match_rule_result WHERE match_rule = %s AND candidate = %s",
        (GATE, CANDIDATE),
    ).fetchall()
    assert versions == [
        (
            live[0],
            "not_matching",
            "no sponsor",
            "manual",
            CHECKED,
            "checked",
            CHECKED,
            CHECKED,
            PAGES,
        )
    ]


def test_its_way_back_refuses_once_an_answer_has_been_corrected(
    before_it: psycopg.Connection,
) -> None:
    connection = before_it
    _run(connection, THE_MIGRATION)
    connection.execute(
        "INSERT INTO match_rule_answer (match_rule, candidate, match_result, data_source, "
        "retrieval_date) VALUES (%s, %s, 'matching', 'manual', now())",
        (GATE, CANDIDATE),
    )

    with (
        pytest.raises(errors.RaiseException, match="cannot roll back 0511: 1 earlier"),
        connection.transaction(),
    ):
        _run(connection, ITS_ROLLBACK)
