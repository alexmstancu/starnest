"""A focus candidate against comparators, over HTTP (`reqs.md` 8.5).

The rule this suite exists for: the synthesis is ordered by what a difference is **worth**, not
by how large it looks. A comparison is always live and stores nothing.
"""

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

pytestmark = pytest.mark.acceptance

MINIMAL = "minimal"
COUNTRY = "country"
PORTUGAL = "country.portugal"
GREECE = "country.greece"


async def _settings(database_url: str, *, comparator_limit: int | None) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max, comparator_limit) VALUES (1, 100, %s)"
                " ON CONFLICT (id) DO UPDATE SET comparator_limit = EXCLUDED.comparator_limit,"
                " score_scale_max = 100",
                (comparator_limit,),
            )


async def _compare(api: httpx.AsyncClient, **params: object) -> httpx.Response:
    return await api.get(
        "/v1/comparisons",
        params={"criteria_set": MINIMAL, "level": COUNTRY, "focus": PORTUGAL, **params},
    )


class TestTheTable:
    async def test_each_row_shows_both_sides_with_their_provenance(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        await _settings(database_url, comparator_limit=5)

        body = (await _compare(api, comparators=[GREECE])).json()

        row = next(r for r in body["attributes"] if r["focus"].get("value"))
        assert row["focus"]["value"]["data_source"]
        assert row["focus"]["value"]["reference_period"]["start"]
        (cell,) = row["comparators"]
        assert cell["candidate"] == GREECE
        assert cell["value"]["candidate"] == GREECE
        # A side with no figure omits the key rather than sending null: absent and null are
        # different claims, and the design types this one as an object (`api/bodies.py`).
        assert any("value" not in r["focus"] for r in body["attributes"])

    async def test_the_gap_is_in_the_attributes_own_unit_and_its_worth_beside_it(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        """Portugal's housing overburden is 5% against Greece's 28%: a gap of -23 points of the
        attribute, and a positive contribution because less is better."""
        await _settings(database_url, comparator_limit=5)

        body = (await _compare(api, comparators=[GREECE])).json()

        overburden = next(
            r
            for r in body["attributes"]
            if r["attribute"] == "country.housing_cost_overburden_rate"
        )
        (cell,) = overburden["comparators"]
        assert cell["delta"] == pytest.approx(-23.0)
        assert cell["weighted_contribution"] > 0

    async def test_the_focus_and_comparators_carry_their_scores(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        await _settings(database_url, comparator_limit=5)

        body = (await _compare(api, comparators=[GREECE])).json()

        assert body["focus"]["candidate"] == PORTUGAL
        assert body["focus"]["score"] is not None
        assert [c["candidate"] for c in body["comparators"]] == [GREECE]


class TestTheSynthesis:
    async def test_it_names_the_pair_and_reads_from_the_numbers(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        await _settings(database_url, comparator_limit=5)

        body = (await _compare(api, comparators=[GREECE])).json()

        (pair,) = body["synthesis"]
        assert pair["comparator"] == GREECE
        assert pair["score_delta"] == body["focus"]["score"] - body["comparators"][0]["score"]
        assert all("worth " in line for line in pair["advantages"])

    async def test_advantages_are_ordered_by_what_they_are_worth(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        """Each line ends with the points it is worth, so the order is checkable from the text."""
        await _settings(database_url, comparator_limit=5)

        body = (await _compare(api, comparators=[GREECE])).json()

        worth = [
            float(line.rsplit("worth ", 1)[1].split(" ")[0])
            for line in body["synthesis"][0]["advantages"]
        ]
        assert worth == sorted(worth, reverse=True)


class TestWhatIsRefused:
    async def test_more_comparators_than_the_limit(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        await _settings(database_url, comparator_limit=1)

        response = await _compare(api, comparators=[GREECE, "country.spain"])

        assert response.status_code == 409
        assert response.json()["code"] == "invalid_comparison"

    async def test_a_comparator_that_is_not_in_this_ranking(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        """Which is how levels stay unmixed: a city is not in a country ranking."""
        await _settings(database_url, comparator_limit=5)

        response = await _compare(api, comparators=["city.lisbon"])

        assert response.status_code == 409
        assert "not in this ranking" in response.json()["message"]

    async def test_a_focus_compared_with_itself(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        await _settings(database_url, comparator_limit=5)

        assert (await _compare(api, comparators=[PORTUGAL])).status_code == 409

    async def test_no_comparator_limit_configured(
        self, api: httpx.AsyncClient, database_url: str, stored_figures: None
    ) -> None:
        """The bound is the household's (`reqs.md` 8.5). Defaulting to five here would be the
        hardcoded limit that requirement forbids."""
        await _settings(database_url, comparator_limit=None)

        response = await _compare(api, comparators=[GREECE])

        assert response.status_code == 409
        assert response.json()["code"] == "comparator_limit_not_set"
