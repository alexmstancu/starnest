"""Every numeric bound the design states, walked against the server (PL-028, PL-030).

A bound lives in three places -- the contract, the server and the interface -- and each can
drift alone. The probes here are read from `docs/openapi.yaml` rather than written beside the
endpoint, so a bound the server enforces and the design never states fails as surely as one the
design states and the server ignores. The interface holds itself to the same file, which keeps
the three equal.

A refusal names its field, its `kind` and the `limit` that refused it, so a form can say "At
most 20." on the right box without reading the developer's sentence.
"""

from decimal import Decimal
from typing import Any

import httpx
import pytest
import yaml

from .contract import DESIGN

pytestmark = pytest.mark.acceptance

A_HOUSEHOLD = {
    "net_income": 5000,
    "number_adults": 2,
    "number_children": 0,
    "home_country_candidate": "country.romania",
    "citizenships": ["country.romania"],
}

SCHEMAS = yaml.safe_load(DESIGN.read_text())["components"]["schemas"]

#: One step outside a bound: a whole unit for an integer, a cent for a number.
STEP = {"integer": Decimal(1), "number": Decimal("0.01")}

#: Which validator refused a value, by the side of the bound it lay beyond.
KIND = {"minimum": "greater_than_equal", "maximum": "less_than_equal"}

#: Each walked schema, the path that replaces it, and a body with every required field valid.
FORMS = {
    "SettingsInput": ("/v1/settings", {}),
    "HouseholdInput": ("/v1/household", A_HOUSEHOLD),
}


#: A bound the request accepts and the domain then refuses on its own ground, with its own code.
#: The shipped sets anchor a criterion at a score of 100, so a scale of 1 cannot hold it (PL-006).
REFUSED_BY_THE_DOMAIN = {("score_scale_max", 1): (409, "score_scale_below_anchors")}


def _numeric_type(property_schema: dict[str, Any]) -> str | None:
    declared = property_schema.get("type")
    types = declared if isinstance(declared, list) else [declared]
    return next((kind for kind in ("integer", "number") if kind in types), None)


def _bounds() -> list[tuple[str, str, str, int | float]]:
    """(schema, field, minimum|maximum, bound) for every numeric bound the design declares."""
    found = []
    for schema in FORMS:
        for field, property_schema in SCHEMAS[schema]["properties"].items():
            if _numeric_type(property_schema) is None:
                continue
            found += [
                (schema, field, side, property_schema[side])
                for side in ("minimum", "maximum")
                if side in property_schema
            ]
    return found


BOUNDS = _bounds()


def _outside(schema: str, field: str, side: str, bound: int | float) -> int | float:
    step = STEP[_numeric_type(SCHEMAS[schema]["properties"][field]) or "number"]
    beyond = Decimal(str(bound)) + (step if side == "maximum" else -step)
    return int(beyond) if step == 1 else float(beyond)


def test_the_walk_reaches_every_bound_the_forms_have() -> None:
    """Guards the walk: a contract read that found nothing would pass every probe below."""
    assert {(field, side) for _schema, field, side, _bound in BOUNDS} >= {
        ("min_coverage", "minimum"),
        ("min_coverage", "maximum"),
        ("score_scale_max", "minimum"),
        ("comparator_limit", "minimum"),
        ("comparator_limit", "maximum"),
        ("run_spend_cap_eur", "minimum"),
        ("refetch_older_than_days", "minimum"),
        ("net_income", "minimum"),
        ("number_adults", "minimum"),
        ("number_children", "minimum"),
        ("target_monthly_spend", "minimum"),
        ("max_rent", "minimum"),
    }


@pytest.mark.parametrize(("schema", "field", "side", "bound"), BOUNDS, ids=lambda part: str(part))
async def test_the_bound_itself_is_accepted(
    api: httpx.AsyncClient, schema: str, field: str, side: str, bound: int | float
) -> None:
    path, base = FORMS[schema]

    response = await api.put(path, json={**base, field: bound})

    if (field, bound) in REFUSED_BY_THE_DOMAIN:
        status, code = REFUSED_BY_THE_DOMAIN[(field, bound)]
        assert (response.status_code, response.json()["code"]) == (status, code)
        return
    assert response.status_code == 200, response.text[:200]
    assert response.json()[field] == bound


@pytest.mark.parametrize(("schema", "field", "side", "bound"), BOUNDS, ids=lambda part: str(part))
async def test_one_step_outside_is_refused_on_that_field_with_its_limit(
    api: httpx.AsyncClient, schema: str, field: str, side: str, bound: int | float
) -> None:
    path, base = FORMS[schema]

    response = await api.put(path, json={**base, field: _outside(schema, field, side, bound)})

    assert response.status_code == 422, response.text[:200]
    assert response.json()["code"] == "invalid_request"
    problems = response.json()["details"]["errors"]
    assert [(p["location"], p["kind"], p["limit"]) for p in problems] == [
        (["body", field], KIND[side], bound)
    ]


class TestTheComparatorLimit:
    """Twenty is the product's ceiling (design DECISIONS, 2026-09-20), and now the contract's."""

    async def test_twenty_one_is_refused_naming_twenty(self, api: httpx.AsyncClient) -> None:
        response = await api.put("/v1/settings", json={"comparator_limit": 21})

        assert response.status_code == 422
        (problem,) = response.json()["details"]["errors"]
        assert problem == {
            "location": ["body", "comparator_limit"],
            "problem": problem["problem"],
            "kind": "less_than_equal",
            "limit": 20,
        }

    async def test_twenty_is_stored_and_read_back(self, api: httpx.AsyncClient) -> None:
        await api.put("/v1/settings", json={"comparator_limit": 20})

        assert (await api.get("/v1/settings")).json()["comparator_limit"] == 20
