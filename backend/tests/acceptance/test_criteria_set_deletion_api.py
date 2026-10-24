"""Deleting a criteria set can be undone, and a new set copies the default (map-C03 B3).

PL-033 (UF-025): `DELETE /criteria-sets/{id}` destroyed a set with no way back. It now deletes in
place (P1-27): every operation that names the set answers 404, as for one never made, and
`POST /criteria-sets/{id}/restore` brings it back answering exactly what it answered before.
PL-035 (UF-031): a set some saved ranking used can therefore be deleted, and the ranking stays
readable. PL-034 (UF-027): `POST /criteria-sets` made an empty set nothing could rank; a new set
is now a full copy of the default (P1-29), read even when the default is deleted.
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.api.document import served_schema

from .contract import validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
DEFAULT = "local_employment"
PORTUGAL = "country.portugal"
GREECE = "country.greece"
OVERBURDEN = "country.housing_cost_overburden_rate"
COPY = "copied_by_the_request"
A_NEW_SET = {"id": "made_from_the_default", "name": "Made from the default"}

THE_SET_ITS_CONTENTS = (
    "criteria",
    "pillar_weights",
    "enforced_match_rules",
    "applied_compound_rules",
)


def a_request_naming(criteria_set: str) -> dict[str, tuple[str, str, dict[str, Any]]]:
    """One well-formed call of every served operation that names a criteria set, by operation id.

    Each answers for a live set (asserted below), so the 404 it gives once the set is deleted is
    the deletion's, not a malformed request's.
    """
    on_the_set = f"/v1/criteria-sets/{criteria_set}"
    ranked = {"criteria_set": criteria_set, "level": COUNTRY}
    return {
        "getCriteriaSet": ("get", on_the_set, {}),
        "renameCriteriaSet": ("patch", on_the_set, {"json": {"name": "Renamed by G3"}}),
        "deleteCriteriaSet": ("delete", on_the_set, {}),
        "updateCriterion": (
            "patch",
            f"{on_the_set}/criteria/{OVERBURDEN}",
            {"json": {"weight": 60}},
        ),
        "duplicateCriteriaSet": (
            "post",
            f"{on_the_set}/duplicate",
            {"json": {"id": COPY, "name": "Copied by the request"}},
        ),
        "updatePillarWeight": (
            "put",
            f"{on_the_set}/pillar-weights/housing",
            {"json": {"weight": 60}},
        ),
        "setMatchRuleEnforcement": (
            "put",
            f"{on_the_set}/match-rules/uk_skilled_worker",
            {"json": {"is_enforced": True}},
        ),
        "setCompoundRuleApplication": (
            "put",
            f"{on_the_set}/compound-rules/cheap_but_taxed",
            {"json": {"is_applied": True}},
        ),
        "getRanking": ("get", "/v1/rankings", {"params": ranked}),
        "getRankedCandidateDetail": (
            "get",
            f"/v1/rankings/candidates/{PORTUGAL}",
            {"params": ranked},
        ),
        "saveEvaluation": ("post", "/v1/evaluations", {"json": ranked}),
        "getComparison": (
            "get",
            "/v1/comparisons",
            {"params": {**ranked, "focus": PORTUGAL, "comparators": [GREECE]}},
        ),
    }


THE_WAY_BACK = "restoreCriteriaSet"
"""The one operation naming a set that must reach a deleted one."""


def _served_operations_naming_a_set() -> set[str]:
    """Every served operation with a set in its path, its query or its body."""
    served = served_schema()
    schemas = served["components"]["schemas"]
    naming = set()
    for item in served["paths"].values():
        for operation in item.values():
            named = {parameter["name"] for parameter in operation.get("parameters", ())}
            body = operation.get("requestBody", {}).get("content", {}).get("application/json", {})
            reference = body.get("schema", {}).get("$ref")
            if reference:
                named |= set(schemas[reference.rsplit("/", 1)[-1]].get("properties", {}))
            if named & {"criteria_set", "criteria_set_id"}:
                naming.add(operation["operationId"])
    return naming


@pytest.fixture
async def purged_afterwards(
    purge_criteria_set: Callable[[str], Awaitable[None]],
) -> AsyncIterator[list[str]]:
    """Ids a test may make; each is purged afterwards, live, deleted or never made."""
    made: list[str] = []
    yield made
    for identifier in made:
        await purge_criteria_set(identifier)


@pytest.fixture
async def ranked_with_figures(api: httpx.AsyncClient, stored_figures: None) -> None:
    """A scale and a comparator limit, so a ranking and a comparison can answer at all."""
    await api.put("/v1/settings", json={"score_scale_max": 100, "comparator_limit": 5})


async def _set_default(database_url: str, criteria_set: str | None) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute("UPDATE criteria_set SET is_default = false WHERE is_default")
            if criteria_set is not None:
                await connection.execute(
                    "UPDATE criteria_set SET is_default = true WHERE id = %s", (criteria_set,)
                )


def _contents(body: dict[str, Any]) -> dict[str, Any]:
    return {key: body[key] for key in THE_SET_ITS_CONTENTS}


class TestADeletedSetIsGoneUntilRestored:
    def test_every_operation_naming_a_set_is_checked(self) -> None:
        """G3's own guard: an operation served later that names a set joins the list below,
        or this fails."""
        assert set(a_request_naming("any")) == _served_operations_naming_a_set() - {THE_WAY_BACK}

    @pytest.mark.parametrize("operation", sorted(a_request_naming("any")))
    async def test_each_answers_404_once_it_is_deleted_and_restore_gives_it_back(
        self,
        api: httpx.AsyncClient,
        a_scratch_criteria_set: str,
        ranked_with_figures: None,
        purged_afterwards: list[str],
        operation: str,
    ) -> None:
        """T33-B4 (G3): a deleted set is no set to every operation, and the restore is exact."""
        method, path, request = a_request_naming(a_scratch_criteria_set)[operation]
        purged_afterwards.append(COPY)
        if operation != "deleteCriteriaSet":
            live = await api.request(method.upper(), path, **request)
            assert live.status_code < 400, f"{operation} refused a live set: {live.text[:200]}"
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        assert (await api.delete(f"/v1/criteria-sets/{a_scratch_criteria_set}")).status_code == 204
        refused = await api.request(method.upper(), path, **request)
        restored = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")

        assert (refused.status_code, refused.json()["code"]) == (404, "not_found")
        assert restored.status_code == 200
        validate(THE_WAY_BACK, restored.json())
        assert restored.json() == before
        assert (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json() == before

    async def test_restoring_twice_gives_the_same_set(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """T33-B5: idempotent, because an identifier names one set for ever."""
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        await api.delete(f"/v1/criteria-sets/{a_scratch_criteria_set}")

        first = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")
        second = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")

        assert (first.status_code, second.status_code) == (200, 200)
        assert first.json() == second.json() == before

    async def test_restoring_a_set_nobody_made_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.post("/v1/criteria-sets/nobody_made_this/restore")

        assert (response.status_code, response.json()["code"]) == (404, "not_found")

    async def test_restoring_over_a_name_taken_meanwhile_is_refused_naming_it(
        self,
        api: httpx.AsyncClient,
        a_scratch_criteria_set: str,
        purged_afterwards: list[str],
    ) -> None:
        """P1-35: the set stays deleted, and the refusal says which name is in the way."""
        name = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()["name"]
        await api.delete(f"/v1/criteria-sets/{a_scratch_criteria_set}")
        purged_afterwards.append(A_NEW_SET["id"])
        taken = await api.post("/v1/criteria-sets", json={**A_NEW_SET, "name": name})
        assert taken.status_code == 201

        refused = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")

        assert refused.status_code == 409
        assert refused.json()["code"] == "criteria_set_name_taken"
        assert refused.json()["details"] == {"name": name}
        assert (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).status_code == 404


class TestASetSavedRankingsUsed:
    async def test_it_can_be_deleted_and_its_rankings_still_open_unchanged(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, ranked_with_figures: None
    ) -> None:
        """T35-B1. The deletion keeps the row a saved ranking names, so nothing holds it off."""
        kept = await api.post(
            "/v1/evaluations", json={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        )
        assert kept.status_code == 201
        reads = (
            "/v1/evaluations",
            f"/v1/evaluations/{kept.json()['id']}",
            f"/v1/evaluations/{kept.json()['id']}/criteria",
            f"/v1/evaluations/{kept.json()['id']}/candidates/{PORTUGAL}",
        )
        before = [(await api.get(read)).json() for read in reads]

        deleted = await api.delete(f"/v1/criteria-sets/{a_scratch_criteria_set}")

        assert deleted.status_code == 204
        assert [(await api.get(read)).json() for read in reads] == before


class TestANewSetCopiesTheDefault:
    async def test_it_holds_everything_the_default_holds_and_ranks_where_it_ranks(
        self, api: httpx.AsyncClient, ranked_with_figures: None, purged_afterwards: list[str]
    ) -> None:
        """T34-B1: a full copy, so it can be ranked wherever the default can."""
        default = (await api.get(f"/v1/criteria-sets/{DEFAULT}")).json()
        purged_afterwards.append(A_NEW_SET["id"])

        created = await api.post("/v1/criteria-sets", json=A_NEW_SET)

        assert created.status_code == 201
        validate("createCriteriaSet", created.json(), status=201)
        assert (created.json()["id"], created.json()["name"]) == (
            A_NEW_SET["id"],
            A_NEW_SET["name"],
        )
        assert _contents(created.json()) == _contents(default)
        assert (await api.get(f"/v1/criteria-sets/{A_NEW_SET['id']}")).json() == created.json()
        ranked = [
            (
                await api.get("/v1/rankings", params={"criteria_set": s, "level": COUNTRY})
            ).status_code
            for s in (DEFAULT, A_NEW_SET["id"])
        ]
        assert ranked == [200, 200]

    async def test_it_copies_the_default_even_once_the_default_is_deleted(
        self, api: httpx.AsyncClient, purged_afterwards: list[str]
    ) -> None:
        """T34-B2 (P1-29): the default is the flagged set, listed or not."""
        default = (await api.get(f"/v1/criteria-sets/{DEFAULT}")).json()
        purged_afterwards.append(A_NEW_SET["id"])
        await api.delete(f"/v1/criteria-sets/{DEFAULT}")
        try:
            created = await api.post("/v1/criteria-sets", json=A_NEW_SET)
        finally:
            restored = await api.post(f"/v1/criteria-sets/{DEFAULT}/restore")

        assert created.status_code == 201
        assert _contents(created.json()) == _contents(default)
        assert restored.json() == default

    async def test_with_no_default_it_is_refused_and_nothing_is_written(
        self, api: httpx.AsyncClient, database_url: str, purged_afterwards: list[str]
    ) -> None:
        """T34-B3: refused rather than made empty, which is the set nothing could rank."""
        listed = (await api.get("/v1/criteria-sets")).json()
        purged_afterwards.append(A_NEW_SET["id"])
        await _set_default(database_url, None)
        try:
            refused = await api.post("/v1/criteria-sets", json=A_NEW_SET)
        finally:
            await _set_default(database_url, DEFAULT)

        assert (refused.status_code, refused.json()["code"]) == (409, "no_default_criteria_set")
        assert (await api.get("/v1/criteria-sets")).json() == listed
        assert (await api.get(f"/v1/criteria-sets/{A_NEW_SET['id']}")).status_code == 404


async def _anchor_overburden_to(api: httpx.AsyncClient, criteria_set: str, score: int) -> None:
    anchored = await api.patch(
        f"/v1/criteria-sets/{criteria_set}/criteria/{OVERBURDEN}",
        json={
            "normalisation_method": "fixed",
            "scale_anchors": [
                {"input_value": 0, "score": score},
                {"input_value": 50, "score": 0},
            ],
        },
    )
    assert anchored.status_code == 200, "the arrangement needs the anchor stored"


async def _deleted_with_an_anchor_at_150_then_rescaled(
    api: httpx.AsyncClient, criteria_set: str, score_scale_max: int
) -> None:
    """Anchored under a range of 200, deleted, then the range lowered: the check reads live sets
    only, so the lower range is accepted while the set is deleted."""
    assert (await api.put("/v1/settings", json={"score_scale_max": 200})).status_code == 200
    await _anchor_overburden_to(api, criteria_set, 150)
    assert (await api.delete(f"/v1/criteria-sets/{criteria_set}")).status_code == 204
    rescaled = await api.put("/v1/settings", json={"score_scale_max": score_scale_max})
    assert rescaled.status_code == 200


class TestASetCannotComeBackAboveTheScoreRange:
    """PL-006 meets PL-033: a range lowered while a set was deleted is checked when the set, or a
    copy of it, comes back -- not left for Rank to refuse as `anchor_above_scale`."""

    async def test_restoring_it_is_refused_naming_the_anchor_and_it_stays_deleted(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await _deleted_with_an_anchor_at_150_then_rescaled(api, a_scratch_criteria_set, 100)

        refused = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")

        assert (refused.status_code, refused.json()["code"]) == (409, "score_scale_below_anchors")
        assert refused.json()["details"] == {
            "minimum": 150,
            "criteria_set": a_scratch_criteria_set,
            "attribute": OVERBURDEN,
        }
        assert (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).status_code == 404

    @pytest.mark.parametrize("score_scale_max", [150, None], ids=["reaching it", "unset"])
    async def test_restoring_it_under_a_range_that_reaches_it_is_allowed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, score_scale_max: int | None
    ) -> None:
        await _deleted_with_an_anchor_at_150_then_rescaled(
            api, a_scratch_criteria_set, score_scale_max
        )

        restored = await api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")

        assert restored.status_code == 200

    @pytest.mark.parametrize(
        ("score_scale_max", "status"), [(100, 409), (150, 201)], ids=["refused", "allowed"]
    )
    async def test_copying_it_as_the_deleted_default_is_held_to_the_range(
        self,
        api: httpx.AsyncClient,
        a_scratch_criteria_set: str,
        database_url: str,
        purged_afterwards: list[str],
        score_scale_max: int,
        status: int,
    ) -> None:
        purged_afterwards.append(A_NEW_SET["id"])
        await _set_default(database_url, a_scratch_criteria_set)
        try:
            await _deleted_with_an_anchor_at_150_then_rescaled(
                api, a_scratch_criteria_set, score_scale_max
            )
            created = await api.post("/v1/criteria-sets", json=A_NEW_SET)
        finally:
            await _set_default(database_url, DEFAULT)

        assert created.status_code == status
        if status == 409:
            assert created.json()["code"] == "score_scale_below_anchors"
            assert created.json()["details"]["minimum"] == 150
            assert (await api.get(f"/v1/criteria-sets/{A_NEW_SET['id']}")).status_code == 404
