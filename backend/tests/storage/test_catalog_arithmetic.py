"""The C0 checkpoint: the catalog is arithmetically correct, in the database.

`tools/audit_ontology.py` already checks these sums in `reqs.md`. This checks the same sums
where they will actually be read from. After this, the document and the database cannot
silently disagree -- which is the "nothing hardcoded" invariant becoming enforceable rather
than aspirational (arch.md 1.2).

Written against `reqs.md` 7, not against the migrations.
"""

import psycopg
import pytest

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


def test_pillar_weights_sum_to_one_hundred(connection: psycopg.Connection) -> None:
    """reqs.md 7. Pillar weights sum to 100% within a level, independently of the other."""
    total = connection.execute("SELECT sum(weight) FROM pillar_weight").fetchone()[0]
    assert total == 100


def test_criterion_weights_sum_to_one_hundred_within_every_pillar(
    connection: psycopg.Connection,
) -> None:
    """The second half of the two-level weighting. A pillar that does not sum means one
    attribute silently counts for more or less than the catalog claims."""
    rows = connection.execute(
        """
        SELECT   p.id, sum(c.weight)
        FROM     criterion c
        JOIN     attribute a ON a.id = c.attribute
        JOIN     pillar p    ON p.id = a.pillar
        GROUP BY p.id
        """
    ).fetchall()

    assert rows, "no criteria seeded"
    off = [(pillar, total) for pillar, total in rows if total != 100]
    assert off == [], f"pillars whose criterion weights do not sum to 100: {off}"


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
