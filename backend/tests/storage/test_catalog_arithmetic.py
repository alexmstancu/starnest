"""The C0 checkpoint: the catalog is arithmetically correct, in the database.

`tools/audit_ontology.py` already checks these sums in `reqs.md`. This checks the same sums
where they will actually be read from. After this, the document and the database cannot
silently disagree -- which is the "nothing hardcoded" invariant becoming enforceable rather
than aspirational (arch.md 1.2).

Written against `reqs.md` 7, not against the migrations.
"""

import re
from pathlib import Path

import psycopg
import pytest

REQS = Path(__file__).resolve().parents[3] / "docs" / "reqs.md"
"""`docs/reqs.md`, from `backend/tests/storage/`. Read rather than restated: this file checks
the document against the database, so the document is where the expectation comes from."""

pytestmark = pytest.mark.storage

COUNTRY = "country"

# reqs.md 7.1 -- the eleven load-bearing verticals of a life.
PILLARS = {
    "economics",
    "housing",
    "career",
    "safety",
    "health",
    "climate",
    "connectivity",
    "nature",
    "culture",
    "governance",
    "family",
}

# reqs.md 3.3a. Adding a type is a code change, so this set is closed.
VALUE_TYPES = {
    "Monetary",
    "Quantity",
    "Count",
    "Ratio",
    "Index",
    "LabelSet",
    "ShareComposition",
    "Boolean",
    "AssignedScore",
    "Text",
}

# reqs.md 7.5. Deliberately sparse: every flag is a way for a candidate to drop out on a
# data gap rather than on merit.
REQUIRED_ATTRIBUTES = {
    "country.cost_of_living_index",
    "country.income_tax_effective",
    "country.house_price_to_income_ratio",
    "country.crime_safety_index",
    "country.political_economic_stability",
    "country.healthcare_system_quality",
    "country.rule_of_law",
}


def test_the_eleven_pillars_exist(connection: psycopg.Connection) -> None:
    rows = connection.execute("SELECT id FROM pillar").fetchall()
    seeded = {row[0].removeprefix(f"{COUNTRY}.") for row in rows}
    assert seeded >= PILLARS


def _pillar_weights_that_do_not_sum(connection: psycopg.Connection) -> list[tuple]:
    """Every (criteria set, level) whose pillar weights miss 100.

    **Grouped, not totalled.** Until known-issues D13 this read `sum(weight)` over the whole
    table and compared it to 100, which is only the same question while exactly one criteria
    set at one level is seeded. Two sets splitting a pillar 40/60 still total 100, and the
    checkpoint reported clean -- against a product where duplicating a criteria set is a
    shipped feature (`reqs.md` Q191).
    """
    return [
        row
        for row in connection.execute(
            "SELECT criteria_set, level, sum(weight) FROM pillar_weight"
            " GROUP BY criteria_set, level"
        ).fetchall()
        if row[2] != 100
    ]


def _criterion_weights_that_do_not_sum(connection: psycopg.Connection) -> list[tuple]:
    """Every (criteria set, pillar, level) whose criterion weights miss 100.

    Grouped by all three for the same reason as above: a pillar's weights sum to 100 *within a
    set and within a level*, and grouping by pillar alone silently adds two sets together.
    """
    return [
        row
        for row in connection.execute(
            """
            SELECT   c.criteria_set, c.pillar, a.level, sum(c.weight)
            FROM     criterion c
            JOIN     attribute a ON a.id = c.attribute
            GROUP BY c.criteria_set, c.pillar, a.level
            """
        ).fetchall()
        if row[3] != 100
    ]


def test_pillar_weights_sum_to_one_hundred(connection: psycopg.Connection) -> None:
    """reqs.md 7. Pillar weights sum to 100% within a level, independently of the other."""
    assert _pillar_weights_that_do_not_sum(connection) == []


def test_criterion_weights_sum_to_one_hundred_within_every_pillar(
    connection: psycopg.Connection,
) -> None:
    """The second half of the two-level weighting. A pillar that does not sum means one
    attribute silently counts for more or less than the catalog claims."""
    assert _criterion_weights_that_do_not_sum(connection) == []


def test_the_country_catalog_has_forty_one_attributes(connection: psycopg.Connection) -> None:
    count = connection.execute(
        "SELECT count(*) FROM attribute WHERE id LIKE %s", (f"{COUNTRY}.%",)
    ).fetchone()[0]
    assert count == 41


def test_every_attribute_declares_a_real_value_type(connection: psycopg.Connection) -> None:
    declared = {row[0] for row in connection.execute("SELECT DISTINCT value_type FROM attribute")}
    assert declared <= VALUE_TYPES, f"unknown value types: {declared - VALUE_TYPES}"


def test_exactly_the_seven_required_attributes_block_on_missing_data(
    connection: psycopg.Connection,
) -> None:
    """reqs.md 7.5. Chosen on two conditions together: the score means little without them,
    AND the source covers all 32 seeded countries -- so a gap signals a broken fetch rather
    than a genuinely undocumented place. An eighth would be a new way to lose a candidate."""
    flagged = {
        row[0]
        for row in connection.execute("SELECT attribute FROM criterion WHERE blocks_if_missing")
    }
    assert flagged == REQUIRED_ATTRIBUTES


def test_the_seeded_countries_are_all_present(connection: psycopg.Connection) -> None:
    """reqs.md 6.1 -- EU 27, plus Iceland, Norway and Liechtenstein, plus the UK and
    Switzerland. The last two are why the seed was widened: without them the UK and Swiss
    match rules would ship untested (reqs.md 7.3)."""
    count = connection.execute(
        "SELECT count(*) FROM candidate WHERE level = %s", (COUNTRY,)
    ).fetchone()[0]
    assert count == 32

    ids = {row[0] for row in connection.execute("SELECT id FROM candidate")}
    assert {"country.united_kingdom", "country.switzerland"} <= ids


def test_nothing_provisional_was_invented(connection: psycopg.Connection) -> None:
    """devplan.md 0.3 rule 2, checked rather than trusted.

    Every threshold in reqs.md 7.4 is marked TBD. A seeded number would be a plausible
    figure nobody chose, and the rule would fire on it -- which is the failure mode the
    whole "never fabricate" invariant exists to prevent.
    """
    fired = connection.execute(
        """
        SELECT id FROM compound_rule
        WHERE  (threshold_min IS NOT NULL OR threshold_max IS NOT NULL)
        AND    id IN ('mild_now_brutal_later', 'cheap_but_taxed')
        """
    ).fetchall()
    assert fired == [], f"TBD thresholds must stay NULL until real figures exist: {fired}"


# --- that the two guards above can actually tell (known-issues D13) -------------------------

A_SECOND_SET = "catalog_arithmetic_second_set"
"""Duplicating a criteria set is a shipped feature (`reqs.md` Q191), so a second set is not a
hypothetical -- it is the state the old guards would have reported clean."""


def test_the_pillar_guard_notices_a_second_set_that_does_not_sum(
    connection: psycopg.Connection,
) -> None:
    """Two sets splitting a level 40/60 still total 100. That is the case D13 named."""
    connection.execute(
        "INSERT INTO criteria_set (id, name) VALUES (%s, %s)", (A_SECOND_SET, A_SECOND_SET)
    )
    connection.execute(
        "INSERT INTO pillar_weight (criteria_set, pillar, level, weight)"
        " VALUES (%s, 'economics', %s, 40)",
        (A_SECOND_SET, COUNTRY),
    )

    off = _pillar_weights_that_do_not_sum(connection)

    assert [(row[0], row[2]) for row in off] == [(A_SECOND_SET, 40)]


def test_the_criterion_guard_notices_a_second_set_that_does_not_sum(
    connection: psycopg.Connection,
) -> None:
    """The same for the inner level of the two-level weighting."""
    connection.execute(
        "INSERT INTO criteria_set (id, name) VALUES (%s, %s)", (A_SECOND_SET, A_SECOND_SET)
    )
    connection.execute(
        """
        INSERT INTO criterion (criteria_set, attribute, pillar, value_type, weight, goal,
                               normalisation_method)
        SELECT %s, a.id, a.pillar, a.value_type, 60, 'minimise', 'percentile'
        FROM   attribute AS a
        WHERE  a.id = 'country.cost_of_living_index'
        """,
        (A_SECOND_SET,),
    )

    off = _criterion_weights_that_do_not_sum(connection)

    assert [(row[0], row[1], row[3]) for row in off] == [(A_SECOND_SET, "economics", 60)]


# --- max_age, against reqs.md 7.1 itself (known-issues D7) ----------------------------------

NO_HORIZON = "—"
"""How `reqs.md` 7.1 writes "this never goes stale" in the Max age column."""

NEVER_STALE = {
    "country.climate_zone",
    "country.coastline_access",
    "country.elevation_range",
    "country.natural_diversity",
}
"""The four `reqs.md` 7.1 deliberately leaves without a horizon. Named here so that an
attribute losing its `max_age` by accident cannot pass as one of them."""


def _max_ages_reqs_declares() -> dict[str, str]:
    """The Max age column of `reqs.md` 7.1, read from the document rather than restated.

    This file's whole premise is that it checks `reqs.md` 7 where it will actually be read
    from, so the expectation comes from `reqs.md` too. Restating 37 intervals here would make
    the test agree with whoever typed them twice.
    """
    lines = REQS.read_text().split("\n")
    start = next(i for i, line in enumerate(lines) if line.startswith("### 7.1 Country level"))
    end = next(i for i, line in enumerate(lines) if line.startswith("### 7.2 City level"))
    row = re.compile(r"^\| `(country\.[a-z_]+)` \|.*\| (\d+ months|—) \|$")
    return {m.group(1): m.group(2) for line in lines[start:end] if (m := row.match(line))}


def test_every_attribute_declares_the_max_age_reqs_gives_it(
    connection: psycopg.Connection,
) -> None:
    """The document and the database, on the one column that decides what counts as stale.

    Until `0111` all 41 were NULL, so **rule 2 of the active-value view had never fired against
    real data** and the age downgrade in the confidence derivation had no input: a mechanism
    fully built, fully tested, and never once run (known-issues D7).

    **Compared in the database, not in Python.** An interval is not a number of days -- 24
    months added to 31 January is not 730 days added to it -- so the comparison happens where
    the type knows that. A first draft of this test converted months to days in Python and
    failed against a correctly seeded catalog.
    """
    declared = _max_ages_reqs_declares()
    assert len(declared) == 41, "reqs.md 7.1 should list all 41 country attributes"

    with_a_horizon = {a: v for a, v in declared.items() if v != NO_HORIZON}
    disagreeing = connection.execute(
        """
        SELECT   stated.attribute, a.max_age, stated.max_age
        FROM     unnest(%s::text[], %s::interval[]) AS stated (attribute, max_age)
        JOIN     attribute AS a ON a.id = stated.attribute
        WHERE    a.max_age IS DISTINCT FROM stated.max_age
        ORDER BY stated.attribute
        """,
        (list(with_a_horizon), list(with_a_horizon.values())),
    ).fetchall()

    assert disagreeing == [], f"reqs.md 7.1 and the catalog disagree: {disagreeing}"


def test_only_the_documented_four_are_never_stale(connection: psycopg.Connection) -> None:
    """A missing horizon must be the decision `reqs.md` records, not an attribute overlooked."""
    without = {
        row[0]
        for row in connection.execute(
            "SELECT id FROM attribute WHERE id LIKE %s AND max_age IS NULL", (f"{COUNTRY}.%",)
        ).fetchall()
    }

    assert without == NEVER_STALE
