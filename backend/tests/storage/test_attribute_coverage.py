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

from datetime import date, datetime
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


def _a_country_level_value(connection: psycopg.Connection, *, candidate: str) -> None:
    """One stored figure for `country.press_freedom`, for whichever candidate is named.

    Written here rather than through the store because the question is about the SQL: what
    `select_attribute_coverage` counts when the rows it joins do not all belong to the level it
    was asked about.
    """
    connection.execute(
        """
        INSERT INTO value (candidate, attribute, value_type, data_source,
                           reference_period_start, reference_period_end,
                           retrieval_date, confidence_level)
        VALUES (%s, 'country.press_freedom', 'Index', 'rsf', %s, %s, %s, 'high')
        """,
        (candidate, date(2025, 1, 1), date(2025, 12, 31), datetime(2026, 1, 15)),
    )


def test_a_candidate_at_another_level_is_not_counted(connection: psycopg.Connection) -> None:
    """**The level filter has to filter** (P73).

    The join narrows the candidates to the level asked for, and the count ignored it: it
    counted `v.candidate`, which is present whether or not the join matched, so a value
    belonging to a city was counted toward a country attribute's coverage. Counting the joined
    `c.id` is what makes a NULL from a failed join drop out.

    **This test needs rows to say anything.** The two above run against an empty `value` table,
    where every count is zero and the join could be deleted outright without either noticing.
    """
    connection.execute(
        "INSERT INTO candidate (id, name, level, parent_level, parent_candidate,"
        " parent_required) VALUES"
        " ('city.lisbon', 'Lisbon', 'city', 'country', 'country.portugal', true)"
    )
    _a_country_level_value(connection, candidate="city.lisbon")

    rows = connection.execute(
        COVERAGE, {"level": "country", "attributes": ["country.press_freedom"]}
    ).fetchall()

    assert rows == [("country.press_freedom", 0)]


def test_a_candidate_at_the_level_asked_about_is_counted(connection: psycopg.Connection) -> None:
    """The other half, so the fix above cannot be "count nothing"."""
    _a_country_level_value(connection, candidate="country.portugal")

    rows = connection.execute(
        COVERAGE, {"level": "country", "attributes": ["country.press_freedom"]}
    ).fetchall()

    assert rows == [("country.press_freedom", 1)]
