"""Every response this API sends, against the shape `docs/openapi.yaml` promises.

**The point is independence.** An assertion written beside an endpoint restates what its author
meant, and fails only when the code disagrees with the author. The design was written earlier,
for a different consumer -- the interface generates its typed client from it -- so a check
against it fails when the code disagrees with what was *agreed*. Only the second kind catches
"I meant the wrong thing", which is how `insufficient_reason` reached the server and never
reached the client's types.

**Parametrised over what is served**, not over a list kept by hand. An endpoint added next month
is checked the day it exists, without anybody remembering to add a case here -- which is the
whole reason this file is worth more than the sum of its assertions.
"""

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.api.document import served_schema

from .contract import undeclared_fields, validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MINIMAL = "minimal"

A_REQUEST_FOR = {
    "getSettings": ("get", "/v1/settings", {}),
    "getHousehold": ("get", "/v1/household", {}),
    "listPillars": ("get", "/v1/pillars", {}),
    "listAttributes": ("get", "/v1/attributes", {"level": COUNTRY}),
    "listLevels": ("get", "/v1/levels", {}),
    "listCriteriaSets": ("get", "/v1/criteria-sets", {}),
    "listCandidates": ("get", "/v1/candidates", {"level": COUNTRY}),
    "listRuns": ("get", "/v1/data-acquisition-runs", {}),
    "getCriteriaSet": ("get", f"/v1/criteria-sets/{MINIMAL}", {}),
    "getRanking": ("get", "/v1/rankings", {"criteria_set": MINIMAL, "level": COUNTRY}),
}
"""One successful call per served GET, by operation id.

`updateCriterion` is absent because it writes; it is checked in the write test below, which owns
a criteria set it may change. A read that needed cleanup would make this file about state.
"""


def _served_get_operations() -> set[str]:
    return {
        operation["operationId"]
        for path, item in served_schema()["paths"].items()
        for method, operation in item.items()
        if method == "get" and operation.get("operationId")
    }


COVERED_BY_A_SEQUENCE = frozenset({"getRun"})
"""Reads that need something to exist before they can be read.

`getRun` needs a run, so it is checked in `test_the_run_endpoints_match_the_designed_shapes`
alongside the plan and the start -- in the order a client meets them, rather than parametrised
apart from the thing that creates what it reads.
"""


def test_every_served_read_has_a_conformance_case() -> None:
    """The guard on the guard.

    Parametrising over a hand-kept list would quietly stop covering the endpoint added after
    somebody forgot to extend it -- so the list is compared to what is actually served, and
    falls behind loudly instead. An operation checked by a dedicated test is named above rather
    than dropped, so "covered elsewhere" stays a decision somebody wrote down.
    """
    assert _served_get_operations() == set(A_REQUEST_FOR) | COVERED_BY_A_SEQUENCE


@pytest.mark.parametrize("operation", sorted(A_REQUEST_FOR))
async def test_the_response_matches_the_designed_schema(
    api: httpx.AsyncClient, operation: str, database_url: str, a_configured_household: str
) -> None:
    """Against the design, byte for byte, including types the language does not distinguish.

    `Decimal` serialises as a JSON string and the contract says `number`; Python cannot tell
    those apart and this can.
    """
    await _set_the_score_scale(database_url, 100)
    method, path, params = A_REQUEST_FOR[operation]

    response = await getattr(api, method)(path, params=params)

    assert response.status_code == 200
    validate(operation, response.json())


async def test_the_write_response_matches_the_designed_schema(
    api: httpx.AsyncClient, a_scratch_criteria_set: str
) -> None:
    """`updateCriterion`, on a set the test owns so the seeded catalog is untouched."""
    response = await api.patch(
        f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/country.housing_cost_overburden_rate",
        json={"weight": 70},
    )

    assert response.status_code == 200
    validate("updateCriterion", response.json())


async def test_a_ranking_with_real_figures_still_matches_the_schema(
    api: httpx.AsyncClient, database_url: str, stored_figures: None
) -> None:
    """The empty case and the populated case are different shapes.

    An endpoint that validates with no data and not with data is the more likely of the two to
    ship: the nulls are what a first test reaches, and the numbers are what a user sees.
    """
    response = await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})

    body = response.json()
    validate("getRanking", body)
    assert any(candidate["score"] is not None for candidate in body["candidates"])
    assert any(candidate["score"] is None for candidate in body["candidates"])


async def _set_the_score_scale(database_url: str, scale: int) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
                (scale,),
            )


@pytest.mark.parametrize("operation", sorted(A_REQUEST_FOR))
async def test_the_response_carries_no_field_the_design_never_declared(
    api: httpx.AsyncClient,
    operation: str,
    database_url: str,
    stored_figures: None,
    a_configured_household: str,
) -> None:
    """The half schema validation cannot do.

    JSON Schema permits extra properties by default, so a response carrying a field nobody
    agreed to validates cleanly. That is exactly how `insufficient_reason` reached the server
    while the interface's generated client -- built from this same design -- had no such field
    and could not show it.
    """
    method, path, params = A_REQUEST_FOR[operation]

    response = await getattr(api, method)(path, params=params)

    assert undeclared_fields(operation, response.json()) == []


async def test_the_write_response_carries_no_undeclared_field(
    api: httpx.AsyncClient, a_scratch_criteria_set: str
) -> None:
    response = await api.patch(
        f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/country.housing_cost_overburden_rate",
        json={"weight": 70},
    )

    assert undeclared_fields("updateCriterion", response.json()) == []


async def test_a_stored_household_comes_back_in_the_designed_shape(
    api: httpx.AsyncClient, a_configured_household: str
) -> None:
    """`replaceHousehold` returns what was stored rather than a bare 200, so its response is a
    shape a client reads and therefore a shape worth checking."""
    from .conftest import A_HOUSEHOLD

    response = await api.put("/v1/household", json=A_HOUSEHOLD)

    assert response.status_code == 200
    validate("replaceHousehold", response.json())
    assert undeclared_fields("replaceHousehold", response.json()) == []


async def test_the_run_endpoints_match_the_designed_shapes(
    api: httpx.AsyncClient, a_configured_household: str
) -> None:
    """Plan, start and poll, checked as one sequence because that is how they are used.

    A run's detail shape can only be checked against a run that exists, so the three are
    exercised in the order a client meets them rather than parametrised apart.
    """
    scope = {"level": COUNTRY}

    planned = await api.post("/v1/data-acquisition-runs/plan", json=scope)
    validate("planRun", planned.json())
    assert undeclared_fields("planRun", planned.json()) == []

    started = await api.post("/v1/data-acquisition-runs", json=scope)
    assert started.status_code == 202
    validate("startRun", started.json(), status=202)
    assert undeclared_fields("startRun", started.json(), status=202) == []

    polled = await api.get(f"/v1/data-acquisition-runs/{started.json()['id']}")
    validate("getRun", polled.json())
    assert undeclared_fields("getRun", polled.json()) == []
