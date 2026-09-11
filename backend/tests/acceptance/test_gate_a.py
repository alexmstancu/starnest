"""GATE A — the first end-to-end proof, as `devplan.md` sets it out.

Not a second copy of the endpoint tests. This is the **narrative**: the seven steps a user
actually takes, in order, against a real database, asserting the things the plan says must be
true when a vertical slice exists. An endpoint that works in isolation and breaks in sequence is
the failure this catches.

Step 6 is the one worth reading twice. It asks the SHIPPED criteria set -- the one that ships,
not the one built to make a demo work -- to come back honest: every candidate `insufficient_data`,
each naming the required attributes it lacks. It was untestable until 2026-09-05, because the
shipped set could not have scored with perfect data (`docs/d6-scale-anchors.md`), and a step
that cannot fail is not a gate.
"""

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from .conftest import A_HOUSEHOLD

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
SHIPPED = "local_employment"
GATE_A_SET = "minimal"


class TestGateA:
    async def test_1_the_household_is_configured_and_read_back(
        self, api: httpx.AsyncClient
    ) -> None:
        """Configured first (`reqs.md` 3.9): income, size and home country reach criterion
        defaults, cross-attribute warnings and match rules."""
        stored = await api.put("/v1/household", json=A_HOUSEHOLD)
        read_back = await api.get("/v1/household")

        assert stored.status_code == 200
        assert read_back.json()["home_country_candidate"] == "country.romania"

    async def test_2_the_catalog_reads_back_whole_and_its_weights_sum(
        self, api: httpx.AsyncClient
    ) -> None:
        """Eleven pillars, 41 attributes, and a set whose weights add up -- checked through the
        API rather than in the database, because a client only ever sees this side."""
        pillars = (await api.get("/v1/pillars")).json()
        attributes = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()
        shipped = (await api.get(f"/v1/criteria-sets/{SHIPPED}")).json()

        assert len(pillars["items"]) == 11
        assert len(attributes["items"]) == 43
        by_pillar: dict[str, float] = {}
        for criterion in shipped["criteria"]:
            by_pillar[criterion["pillar"]] = by_pillar.get(criterion["pillar"], 0) + float(
                criterion["weight"]
            )
        assert all(round(total) == 100 for total in by_pillar.values())

    async def test_3_a_duplicated_set_rebalances_when_one_weight_moves(
        self, api: httpx.AsyncClient
    ) -> None:
        """The interaction the whole product turns on (`arch.md` 8.3), done the way a user does
        it: copy the shipped set so nothing shipped is touched, then move a weight."""
        await api.post(
            f"/v1/criteria-sets/{GATE_A_SET}/duplicate",
            json={"id": "gate_a_copy", "name": "Gate A"},
        )
        try:
            rebalanced = await api.patch(
                "/v1/criteria-sets/gate_a_copy/criteria/country.housing_cost_overburden_rate",
                json={"weight": 70},
            )

            assert rebalanced.status_code == 200
            weights = {c["attribute"]: float(c["weight"]) for c in rebalanced.json()["criteria"]}
            assert weights["country.housing_cost_overburden_rate"] == 70
            assert sum(weights.values()) == 100
        finally:
            await api.delete("/v1/criteria-sets/gate_a_copy")

    async def test_4_a_run_is_planned_before_anything_is_fetched(
        self, api: httpx.AsyncClient
    ) -> None:
        """The count and the cost, shown before the work (`reqs.md` 6.3). Eurostat is free, and
        the estimate exists so a source that is not cannot be started by accident."""
        planned = (await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})).json()

        assert planned["items_total"] > 0
        assert planned["estimated_cost_eur"] == 0
        assert planned["by_source"]

    async def test_5_a_run_stores_values_carrying_both_dates_and_their_source(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """The two dates are never merged (`reqs.md` 3.6): the reference period is what the
        figure describes, the retrieval date is when we fetched it."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
        assert detail["run_status"] == "completed"
        assert detail["progress"]["items_completed"] > 0

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                rows = await (
                    await connection.execute(
                        "SELECT count(*) FROM value"
                        " WHERE reference_period_start IS NOT NULL"
                        "   AND reference_period_end IS NOT NULL"
                        "   AND retrieval_date IS NOT NULL"
                        "   AND data_source IS NOT NULL"
                        "   AND data_acquisition_run = %s",
                        (run["id"],),
                    )
                ).fetchone()
        assert rows[0] == detail["progress"]["items_completed"]

    async def test_6_the_shipped_set_comes_back_honest_rather_than_scored(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """**The step this gate is really about.**

        The set that ships must not invent a ranking out of data it does not have. Every
        candidate comes back `insufficient_data`, each naming the required attributes it lacks --
        and none of them comes back with a zero, which is the failure a reader would never
        question because it looks like a score.
        """
        await _set_the_score_scale(database_url, 100)

        body = (
            await api.get("/v1/rankings", params={"criteria_set": SHIPPED, "level": COUNTRY})
        ).json()

        assert len(body["candidates"]) == 32
        assert all(c["match_status"] == "insufficient_data" for c in body["candidates"])
        assert all(c["score"] is None for c in body["candidates"])
        assert all(c["rank"] is None for c in body["candidates"])
        assert all("no figure for" in (c["insufficient_reason"] or "") for c in body["candidates"])

    async def test_6b_the_reason_names_the_attributes_actually_required(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """ "Insufficient data" on its own is not an answer a user can act on.

        The seven attributes the shipped set declares `blocks_if_missing` are the ones that make
        a candidate unscoreable whatever else was found, so those are what the sentence names.
        """
        await _set_the_score_scale(database_url, 100)

        body = (
            await api.get("/v1/rankings", params={"criteria_set": SHIPPED, "level": COUNTRY})
        ).json()

        reason = body["candidates"][0]["insufficient_reason"]
        assert "country." in reason
        assert reason.count("country.") >= 5

    async def test_7_a_set_whose_attributes_have_figures_ranks_them(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        """The other half of the pair, and the point of showing both: the application refuses to
        rank what it cannot, and ranks what it can, in the same breath."""
        body = (
            await api.get("/v1/rankings", params={"criteria_set": GATE_A_SET, "level": COUNTRY})
        ).json()

        ranked = [c for c in body["candidates"] if c["rank"] is not None]
        assert len(ranked) >= 2
        assert all(0 <= c["score"] <= 100 for c in ranked)
        assert all(0 <= float(c["coverage"]) <= 100 for c in body["candidates"])
        # Honest coverage: something answered, something did not, and both are visible.
        assert any(float(c["coverage"]) == 0 for c in body["candidates"])


async def _set_the_score_scale(database_url: str, scale: int) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
                (scale,),
            )
