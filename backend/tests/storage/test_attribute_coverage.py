"""The one query that must report an attribute nobody has fetched anything for (D20).

`select_attribute_coverage` answers "how many candidates have an active value for each
attribute", and a run planner compares that against what it wants. **Grouping over
`active_value` cannot say zero**: an attribute with no values produces no group, so it produces
no row -- and a never-fetched attribute is precisely the one the planner most needs to see. The
query's own comment said "for each attribute" throughout.

Driven as SQL on the rolled-back connection because nothing calls this query yet: it is one of
the nineteen listed in `QUERIES_NOTHING_CALLS_YET`, and a statement nobody runs is exactly where
a wrong answer can sit unnoticed.
"""

from pathlib import Path

import aiosql
import psycopg
import pytest

pytestmark = pytest.mark.storage

QUERIES = Path(__file__).resolve().parents[3] / "storage" / "queries"


def _the_coverage_query() -> str:
    """The statement as the file holds it, not a copy of it.

    A test carrying its own SQL tests its own SQL. `aiosql` is how production loads these, so
    it is how this reads them -- and `%(name)s` is already the dialect psycopg speaks.
    """
    return aiosql.from_path(QUERIES, "psycopg").select_attribute_coverage.sql


COVERAGE = _the_coverage_query()


def test_an_attribute_nobody_has_fetched_anything_for_reports_zero(
    connection: psycopg.Connection,
) -> None:
    """The case the old shape could not express, and the only one worth asking about."""
    rows = connection.execute(
        COVERAGE, {"level": "country", "attributes": ["country.press_freedom"]}
    ).fetchall()

    assert rows == [("country.press_freedom", 0)]


def test_every_attribute_at_the_level_gets_a_row(connection: psycopg.Connection) -> None:
    """Coverage of the catalog means the whole catalog, or the denominator is invented."""
    catalogued = connection.execute(
        "SELECT count(*) FROM attribute WHERE level = 'country'"
    ).fetchone()
    rows = connection.execute(COVERAGE, {"level": "country", "attributes": None}).fetchall()

    assert catalogued is not None
    assert len(rows) == catalogued[0]
    assert all(count == 0 for _, count in rows), "the value table is empty in a storage test"
