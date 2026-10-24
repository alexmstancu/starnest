"""The identifiers a new set may take, derived from its name when the request gives none (PL-039).

The server owns the rule `^[a-z][a-z0-9_]*$`, so the server derives: a client deriving under a
rule of its own turned "Ελλάδα" into nothing and "2026 plan" into an identifier the server
refused (S1).
"""

from itertools import islice

import pytest

from starnest.criteria import identifiers_from


def _first(name: str, how_many: int = 3) -> list[str]:
    return [str(identifier) for identifier in islice(identifiers_from(name), how_many)]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Zürich", ["zurich", "zurich_2", "zurich_3"]),
        ("2026 plan", ["set_2026_plan", "set_2026_plan_2", "set_2026_plan_3"]),
        ("Ελλάδα", ["set", "set_2", "set_3"]),
        ("!!", ["set", "set_2", "set_3"]),
        ("  HO-test set! ", ["ho_test_set", "ho_test_set_2", "ho_test_set_3"]),
    ],
)
def test_each_name_yields_its_stem_then_counts_on(name: str, expected: list[str]) -> None:
    """T39-B1. Every candidate is a well-formed identifier, or constructing it would raise."""
    assert _first(name) == expected
