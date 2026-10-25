"""A retype keeps every rule a person put on the criterion it carries across (RE-3).

`0444` retypes `house_price_to_income_ratio` from `Ratio` to `Quantity`: the same number -- "a
home costs 8.2 years of income" -- declared as the kind of number it is. Its criteria are lifted
out and put back because `criterion.value_type` is pinned to the attribute's by a composite
foreign key, and the put-back named only some of the columns it had lifted: a locked weight came
back unlocked, and a target band came back empty, in both directions.

**Run at the migration's own revision, by yoyo itself.** The session's database is at the head,
where `0488` has long since retired this attribute and its criteria; and what is under test is
what the migration does to the schema it was written for. So this builds a private database up
to the migration before, puts rules on the criterion, and applies and rolls back `0444` for real.
"""

from collections.abc import Iterator

import psycopg
import pytest

from .private_database import private_database, yoyo

pytestmark = pytest.mark.storage

BEFORE = "0443-cost-of-living-becomes-a-quantity"
RETYPE = "0444-house-price-ratio-stops-blocking"
HOUSE_PRICE = "country.house_price_to_income_ratio"

#: Everything a person can set on a criterion. `value_type` and `blocks_if_missing` are left
#: out: changing them is what `0444` is for.
RULES = (
    "criteria_set",
    "pillar",
    "is_scored",
    "weight",
    "weight_locked",
    "goal",
    "target_range_min",
    "target_range_max",
    "zero_score_below",
    "zero_score_above",
    "normalisation_method",
    "breakdown_option",
    "reducer_mode",
)


@pytest.fixture
def database_before_the_retype(database_url: str) -> Iterator[str]:
    with private_database(database_url, "retype", revision=BEFORE) as url:
        yield url


def rules_on_the_house_price(url: str) -> list[tuple[object, ...]]:
    with psycopg.connect(url) as connection:
        return connection.execute(
            f"SELECT {', '.join(RULES)} FROM criterion WHERE attribute = %s ORDER BY criteria_set",
            (HOUSE_PRICE,),
        ).fetchall()


def anchors_and_thresholds_on_the_house_price(url: str) -> list[tuple[object, ...]]:
    with psycopg.connect(url) as connection:
        return connection.execute(
            "SELECT c.criteria_set, 'anchor', a.input_value, a.score::numeric, a.label "
            "FROM criterion_scale_anchor a JOIN criterion c ON c.id = a.criterion "
            "WHERE c.attribute = %(attribute)s "
            "UNION ALL SELECT c.criteria_set, 'threshold', t.min_value, t.max_value, t.value_type "
            "FROM criterion_threshold_range t JOIN criterion c ON c.id = t.criterion "
            "WHERE c.attribute = %(attribute)s ORDER BY 1, 2, 3",
            {"attribute": HOUSE_PRICE},
        ).fetchall()


def test_the_retype_keeps_the_anchors_and_the_threshold_both_ways(
    database_before_the_retype: str,
) -> None:
    """Carried across rather than left in the way of the delete (P95, D69), and retyped with
    the criterion they hang off."""
    url = database_before_the_retype
    with psycopg.connect(url) as connection:
        connection.execute(
            "INSERT INTO criterion_scale_anchor (criterion, input_value, score, label) "
            "SELECT id, v.input, v.score, v.label FROM criterion, "
            "(VALUES (4, 100, 'cheap'), (12, 0, NULL)) AS v (input, score, label) "
            "WHERE attribute = %(attribute)s",
            {"attribute": HOUSE_PRICE},
        )
        connection.execute(
            "INSERT INTO criterion_threshold_range (criterion, value_type, max_value) "
            "SELECT id, value_type, 10 FROM criterion WHERE attribute = %(attribute)s",
            {"attribute": HOUSE_PRICE},
        )
    set_by_a_person = anchors_and_thresholds_on_the_house_price(url)
    assert {row[4] for row in set_by_a_person if row[1] == "threshold"} == {"Ratio"}

    yoyo("apply", "--revision", RETYPE, database=url)
    retyped = anchors_and_thresholds_on_the_house_price(url)
    assert retyped == [
        (*row[:4], "Quantity") if row[1] == "threshold" else row for row in set_by_a_person
    ]

    yoyo("rollback", "--revision", RETYPE, database=url)
    assert anchors_and_thresholds_on_the_house_price(url) == set_by_a_person


def test_the_retype_keeps_every_rule_on_the_criterion_both_ways(
    database_before_the_retype: str,
) -> None:
    url = database_before_the_retype
    with psycopg.connect(url) as connection:
        connection.execute(
            "UPDATE criterion SET weight_locked = true, goal = 'target_range', "
            "target_range_min = 4, target_range_max = 7, zero_score_below = 2, "
            "zero_score_above = 12 WHERE attribute = %s",
            (HOUSE_PRICE,),
        )
    set_by_a_person = rules_on_the_house_price(url)
    assert set_by_a_person, f"no criterion judges {HOUSE_PRICE} before {RETYPE}"

    yoyo("apply", "--revision", RETYPE, database=url)
    assert rules_on_the_house_price(url) == set_by_a_person

    yoyo("rollback", "--revision", RETYPE, database=url)
    assert rules_on_the_house_price(url) == set_by_a_person
