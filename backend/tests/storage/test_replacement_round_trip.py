"""Replacing an attribute's criterion keeps what a person chose on it (P97).

`0442`, `0445` and `0488` each move an attribute's criteria onto its successor: crime onto the
homicide rate, income tax onto the total tax rate, the house price ratio onto the housing price
level. Each listed the columns to carry by hand, and the list was written to move the weight:
a locked weight arrived unlocked, and a criterion a person had excluded from scoring arrived
scored, both on the way in and on the way back.

Run at each migration's own revision, by yoyo itself, on a private database copied from one
built once to the earliest of them: the session's database is at the head, where every one of
these has been applied and most of their old criteria are gone.
"""

import importlib.util
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import psycopg
import pytest

from .private_database import apply_through, private_database, yoyo

pytestmark = pytest.mark.storage


@dataclass(frozen=True)
class Replacement:
    before: str
    migration: str
    retiring: str
    replacing: str


REPLACEMENTS = (
    Replacement(
        "0441-health-joins-the-minimal-set",
        "0442-crime-splits-into-a-rate-and-a-composite",
        "country.crime_safety_index",
        "country.homicide_rate",
    ),
    Replacement(
        "0444-house-price-ratio-stops-blocking",
        "0445-total-tax-rate-replaces-income-tax",
        "country.income_tax_effective",
        "country.total_tax_rate_effective",
    ),
    Replacement(
        "0487-career-is-measured-by-the-workforce-that-exists",
        "0488-housing-is-priced-by-what-it-costs-to-live-in",
        "country.house_price_to_income_ratio",
        "country.housing_price_level",
    ),
)

#: What a person chooses on a criterion that a replacement must carry, beside the weight.
CHOSEN = "criteria_set, weight, weight_locked, is_scored"


@pytest.fixture(scope="module")
def earliest(database_url: str) -> Iterator[str]:
    with private_database(database_url, "replace_base", revision=REPLACEMENTS[0].before) as url:
        yield url


def chosen_on(url: str, attribute: str) -> list[tuple[object, ...]]:
    with psycopg.connect(url) as connection:
        return connection.execute(
            f"SELECT {CHOSEN} FROM criterion WHERE attribute = %s ORDER BY criteria_set",
            (attribute,),
        ).fetchall()


@pytest.mark.parametrize("case", REPLACEMENTS, ids=lambda case: case.migration[:4])
def test_a_replacement_carries_the_lock_and_the_exclusion_both_ways(
    case: Replacement, earliest: str, database_url: str
) -> None:
    with private_database(
        database_url, "replace_case", revision=case.before, template=earliest
    ) as url:
        with psycopg.connect(url) as connection:
            connection.execute(
                "UPDATE criterion SET weight_locked = true, is_scored = false WHERE attribute = %s",
                (case.retiring,),
            )
        chosen = chosen_on(url, case.retiring)
        assert chosen, f"no criterion judges {case.retiring} before {case.migration}"

        apply_through(case.migration, database=url)
        assert chosen_on(url, case.replacing) == chosen

        yoyo("rollback", "--revision", case.migration, database=url)
        assert chosen_on(url, case.retiring) == chosen


def test_the_live_check_reads_when_each_replacement_ran_and_what_its_successors_hold(
    database_url: str,
) -> None:
    """`tools/check_lost_locks.py` against a database at the head: the half that is not a dump."""
    script = load_script()

    live = script.read_live(database_url)

    assert set(live.applied) == {replacement.migration for replacement in script.REPLACEMENTS}
    assert ("local_employment", "country.homicide_rate") in live.criteria


def load_script() -> ModuleType:
    path = Path(__file__).resolve().parents[3] / "tools" / "check_lost_locks.py"
    spec = importlib.util.spec_from_file_location("check_lost_locks", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
