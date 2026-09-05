"""The four endpoints minE2E needs, over HTTP, against the real database.

Not unit tests of the handlers: these go through routing, validation, serialisation and the
error handler, because that is the whole of what a client meets. A response shape that is right
in Python and wrong on the wire is still wrong.

The seeded catalog is what they read -- 32 countries, the `minimal` criteria set of `0121` --
because that is what the application actually ships with, and a fixture invented to be
convenient would prove the endpoints work against data that does not exist.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import ConfidenceLevel, Quantity, Ratio, ReferencePeriod, Value, ValueType
from starnest.storage import PostgresValueStore

pytestmark = pytest.mark.acceptance

MINIMAL = "minimal"
COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
SATISFACTION = "country.life_satisfaction"

A_YEAR = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))


async def _set_the_score_scale(pool: AsyncConnectionPool, scale: int | None) -> None:
    async with pool.connection() as connection:
        await connection.execute(
            "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
            " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
            (scale,),
        )


def _a_figure(candidate: str, attribute: str, figure: str) -> Value:
    shape = (
        Quantity(magnitude=Decimal(figure), unit="ladder_points")
        if attribute == SATISFACTION
        else Ratio(value=Decimal(figure), basis="households")
    )
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.QUANTITY if attribute == SATISFACTION else ValueType.RATIO,
        data_source="eurostat",
        reference_period=A_YEAR,
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=shape,
    )


class TestGetSettings:
    async def test_the_endpoint_the_healthcheck_calls_answers(self, api: httpx.AsyncClient) -> None:
        """compose.yaml's healthcheck uses a real endpoint rather than a `/health` route
        invented for it, so this failing takes the container down."""
        response = await api.get("/v1/settings")

        assert response.status_code == 200

    async def test_unset_settings_come_back_as_null_rather_than_as_a_default(
        self, api: httpx.AsyncClient
    ) -> None:
        """The shipped state. All four are provisional by design (`reqs.md` 3.10), and a
        default invented here would be a number nobody chose arriving as one they did."""
        body = (await api.get("/v1/settings")).json()

        assert body == {
            "min_coverage": None,
            "score_scale_max": None,
            "comparator_limit": None,
            "run_spend_cap_eur": None,
        }


class TestGetCriteriaSet:
    async def test_the_minimal_set_comes_back_whole(self, api: httpx.AsyncClient) -> None:
        response = await api.get(f"/v1/criteria-sets/{MINIMAL}", params={"level": COUNTRY})

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == MINIMAL
        assert {c["attribute"] for c in body["criteria"]} == {
            OVERBURDEN,
            OVERCROWDING,
            SATISFACTION,
        }

    async def test_the_criteria_carry_the_interpretation_that_scores_them(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["goal"] == "minimise"
        assert overburden["normalisation_method"] == "percentile"

    async def test_the_pillar_weights_come_with_it(self, api: httpx.AsyncClient) -> None:
        """A screen that showed criteria without pillar weights would show a set that cannot
        add up."""
        body = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()

        assert {w["pillar"] for w in body["pillar_weights"]} == {"housing", "culture"}

    async def test_a_set_that_does_not_exist_is_a_404_in_the_one_error_shape(
        self, api: httpx.AsyncClient
    ) -> None:
        """A client branches on `code`, never on prose (`arch.md` 7.6)."""
        response = await api.get("/v1/criteria-sets/nobody_made_this")

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
        assert response.json()["message"]


class TestUpdateCriterion:
    async def test_moving_a_weight_returns_the_rebalanced_pillar(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The whole pillar, because the whole pillar changed. Returning only the criterion
        asked about would leave the screen showing a set that does not sum to 100."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}", json={"weight": 70}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["pillar"] == "housing"
        weights = {c["attribute"]: Decimal(str(c["weight"])) for c in body["criteria"]}
        assert weights == {OVERBURDEN: Decimal(70), OVERCROWDING: Decimal(30)}

    async def test_the_pillar_still_sums_to_one_hundred(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The invariant the rebalance exists to hold, checked on what the wire carried rather
        than on what the domain believed."""
        body = (
            await api.patch(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
                json={"weight": 65},
            )
        ).json()

        assert sum(Decimal(str(c["weight"])) for c in body["criteria"]) == Decimal(100)

    async def test_the_change_is_stored_and_not_merely_reported(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}", json={"weight": 80}
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert Decimal(str(overburden["weight"])) == Decimal(80)

    async def test_a_weight_outside_the_percentage_range_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """FastAPI's own validation, which is the contract's `minimum`/`maximum` enforced."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 140},
        )

        assert response.status_code == 422


class TestGetRanking:
    async def test_a_ranking_of_real_countries_from_stored_figures(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """minE2E's acceptance condition, over HTTP: a ranked table with a score, a coverage
        percentage and a match status, from figures with reference dates."""
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)
            await PostgresValueStore(pool).append(
                [
                    _a_figure("country.portugal", OVERBURDEN, "5"),
                    _a_figure("country.portugal", OVERCROWDING, "9"),
                    _a_figure("country.portugal", SATISFACTION, "7.1"),
                    _a_figure("country.greece", OVERBURDEN, "28"),
                    _a_figure("country.greece", OVERCROWDING, "27"),
                    _a_figure("country.greece", SATISFACTION, "6.4"),
                ]
            )

            response = await api.get(
                "/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY}
            )

        assert response.status_code == 200
        body = response.json()
        ranked = {c["candidate"]: c for c in body["candidates"] if c["rank"] is not None}
        assert ranked["country.portugal"]["rank"] == 1
        assert ranked["country.portugal"]["score"] > ranked["country.greece"]["score"]
        assert ranked["country.portugal"]["coverage"] == 100
        assert ranked["country.portugal"]["match_status"] == "matching"

    async def test_countries_with_no_figures_are_returned_as_insufficient_data(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Never filtered out. The reason a candidate is out is a thing this product exists to
        show (`reqs.md` 5.4), and a ranking that hid them would be a shorter list that looked
        complete."""
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)
            await PostgresValueStore(pool).append(
                [
                    _a_figure("country.portugal", OVERBURDEN, "5"),
                    _a_figure("country.greece", OVERBURDEN, "28"),
                ]
            )

            body = (
                await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
            ).json()

        unscored = [c for c in body["candidates"] if c["score"] is None]
        assert len(unscored) == 30
        assert all(c["match_status"] == "insufficient_data" for c in unscored)
        assert all(c["insufficient_reason"] for c in unscored)

    async def test_every_candidate_appears_exactly_once(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)

            body = (
                await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
            ).json()

        candidates = [c["candidate"] for c in body["candidates"]]
        assert len(candidates) == 32
        assert len(set(candidates)) == 32

    async def test_no_score_scale_is_refused_rather_than_assumed_to_be_one_hundred(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`devplan.md` 0.3's stop rule applied to a number.

        `score_scale_max` is nullable and unseeded by design. Substituting 100 would produce a
        whole ranking on a scale nobody chose, and every number in it would look right.
        """
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, None)

            response = await api.get(
                "/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY}
            )

        assert response.status_code == 409
        assert "score_scale_max" in response.text
