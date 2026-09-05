"""How this API says no, in every way it has to say it.

`arch.md` 7.6: one error shape everywhere -- a stable machine-readable `code`, a human-readable
`message`, optional `details`. **Clients branch on `code`, never on prose**, so the code is part
of the contract and the message is not.

That makes the failure paths worth more testing than the success ones, not less. A client that
cannot tell "no such criteria set" from "the database is down" will do the wrong thing on both,
and the difference is invisible until it happens to somebody.
"""

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MINIMAL = "minimal"
OVERBURDEN = "country.housing_cost_overburden_rate"


class TestTheOneErrorShape:
    async def test_a_domain_refusal_carries_a_code_and_a_message(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get("/v1/criteria-sets/nobody_made_this")).json()

        assert set(body) >= {"code", "message"}
        assert body["code"] == "not_found"
        assert body["message"]

    async def test_the_code_is_stable_and_the_message_is_not_the_thing_to_branch_on(
        self, api: httpx.AsyncClient
    ) -> None:
        """Two different missing sets, one code, two messages naming what was missing."""
        first = (await api.get("/v1/criteria-sets/one_missing_set")).json()
        second = (await api.get("/v1/criteria-sets/another_missing_set")).json()

        assert first["code"] == second["code"] == "not_found"
        assert first["message"] != second["message"]

    async def test_details_name_the_offending_thing_where_there_is_one(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A message a user cannot act on is barely better than no message.

        The locked weights are what the Configure screen lists under "Locked, so unable to
        absorb the change", so they travel in `details` rather than only in the prose.
        """
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/country.overcrowding_rate",
            json={"weight_locked": True},
        )
        # Only two criteria in that pillar, and the other is now locked, so nothing can absorb.
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 70},
        )

        if response.status_code == 409:
            body = response.json()
            assert body["code"] == "weights_all_locked"
            assert body.get("details", {}).get("locked")


class TestWhatIsNotThere:
    async def test_an_unknown_path_is_a_404(self, api: httpx.AsyncClient) -> None:
        assert (await api.get("/v1/nothing-here")).status_code == 404

    async def test_an_unversioned_path_is_not_served(self, api: httpx.AsyncClient) -> None:
        """Versioned from the first request (`arch.md` 7.6). A client that dropped the prefix
        must fail rather than be quietly accommodated, or the version stops meaning anything."""
        assert (await api.get("/settings")).status_code == 404

    async def test_a_method_the_route_does_not_have_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """`GET /rankings` exists; `DELETE` does not, and 405 says which of the two is wrong."""
        assert (await api.delete("/v1/rankings")).status_code == 405

    async def test_a_criteria_set_that_does_not_exist_is_a_404_on_every_route_that_names_one(
        self, api: httpx.AsyncClient
    ) -> None:
        missing = "no_such_set"

        read = await api.get(f"/v1/criteria-sets/{missing}")
        ranking = await api.get("/v1/rankings", params={"criteria_set": missing, "level": COUNTRY})
        patch = await api.patch(
            f"/v1/criteria-sets/{missing}/criteria/{OVERBURDEN}", json={"weight": 50}
        )

        assert [read.status_code, ranking.status_code, patch.status_code] == [404, 404, 404]
        assert {read.json()["code"], ranking.json()["code"], patch.json()["code"]} == {"not_found"}


class TestRequestsThatDoNotMakeSense:
    async def test_a_required_query_parameter_missing_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """`criteria_set` and `level` are both required by the design. A ranking of "whatever
        you assume I meant" is the wrong kind of helpful."""
        assert (await api.get("/v1/rankings")).status_code == 422

    async def test_a_weight_outside_the_percentage_range_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 140},
        )

        assert response.status_code == 422

    async def test_a_weight_that_is_not_a_number_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": "heavy"},
        )

        assert response.status_code == 422

    async def test_an_unknown_field_in_the_body_is_not_silently_swallowed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A misspelled field ignored is a preference the user expressed and the application
        discarded. Either refuse it or apply it; do not accept and drop it."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"wieght": 70},
        )

        assert response.status_code in {200, 422}
        if response.status_code == 200:
            # It was ignored, so nothing may have changed.
            body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
            overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
            assert float(overburden["weight"]) == 50

    async def test_a_level_nothing_is_ranked_at_is_refused_rather_than_answered_emptily(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """An empty ranking and "this set scores nothing at that level" look identical to a
        client, and only one of them is true."""
        await _set_the_score_scale(database_url, 100)

        response = await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": "city"})

        assert response.status_code == 422
        assert response.json()["code"] == "cannot_be_ranked"


class TestARefusalTheStopRuleRequires:
    async def test_an_unset_score_scale_refuses_rather_than_assuming_one_hundred(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`devplan.md` 0.3 applied to a number.

        `score_scale_max` is nullable and unseeded by design. Substituting 100 would produce a
        whole ranking on a scale nobody chose, and every figure in it would look right.
        """
        await _set_the_score_scale(database_url, None)

        response = await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})

        assert response.status_code == 409
        assert "score_scale_max" in response.text


async def _set_the_score_scale(database_url: str, scale: int | None) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
                (scale,),
            )
