"""The catalog through the API: pillars, attributes, and the declarations that travel with them.

Gate A step 2. Everything here is data, not code (`arch.md` 1.2) -- adding an attribute is a
migration, and these endpoints are how the interface learns what the migration added without
anybody editing TypeScript.
"""

import httpx
import pytest

pytestmark = pytest.mark.acceptance

COUNTRY = "country"


class TestThePillars:
    async def test_all_eleven_come_back(self, api: httpx.AsyncClient) -> None:
        """The load-bearing verticals of a life (`reqs.md` 3.3), returned whole -- eleven rows
        bounded by the catalog need no cursor."""
        body = (await api.get("/v1/pillars")).json()

        assert len(body["items"]) == 11
        assert {"economics", "housing", "safety", "health", "family"} <= {
            pillar["id"] for pillar in body["items"]
        }

    async def test_each_carries_the_name_a_screen_shows(self, api: httpx.AsyncClient) -> None:
        body = (await api.get("/v1/pillars")).json()

        assert all(pillar["name"] for pillar in body["items"])


class TestTheAttributes:
    async def test_every_active_country_attribute_comes_back(self, api: httpx.AsyncClient) -> None:
        """43 since `0466` added a summer day and a winter day (Q213)."""
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        assert len(body["items"]) == 43

    async def test_each_declares_the_type_that_decides_what_a_value_may_be(
        self, api: httpx.AsyncClient
    ) -> None:
        """The value type decides which normalisation methods are legal and what a matching
        threshold means (`reqs.md` 3.3a), so a client that did not have it could not render a
        threshold editor at all."""
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        types = {attribute["value_type"] for attribute in body["items"]}
        assert types <= {
            "Monetary",
            "Quantity",
            "Count",
            "Ratio",
            "Index",
            "LabelSet",
            "ShareComposition",
            "Boolean",
            "AssignedScore",
            "Text",
        }

    async def test_staleness_horizons_come_back_in_months(self, api: httpx.AsyncClient) -> None:
        """Months, because that is the unit `reqs.md` 7.1 declares and the column stores.

        Days would be lossy and slightly wrong -- two years is 730.5 of them, which an integer
        day count cannot say (known-issues D18, closed 2026-09-05).
        """
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        horizons = {
            attribute["max_age_months"]
            for attribute in body["items"]
            if attribute["max_age_months"] is not None
        }
        assert horizons == {3, 12, 24, 60, 72}

    async def test_the_four_attributes_with_no_horizon_say_null(
        self, api: httpx.AsyncClient
    ) -> None:
        """A Koeppen zone and a coastline do not go out of date on this application's horizon,
        and `reqs.md` 7.1 records that as a decision rather than an omission."""
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        never_stale = {
            attribute["id"] for attribute in body["items"] if attribute["max_age_months"] is None
        }
        assert never_stale == {
            "country.climate_zone",
            "country.coastline_access",
            "country.elevation_range",
            "country.natural_diversity",
        }

    async def test_a_quantity_carries_the_unit_its_figures_are_in(
        self, api: httpx.AsyncClient
    ) -> None:
        """A comparison between two quantities is meaningful only if the units agree."""
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        satisfaction = next(a for a in body["items"] if a["id"] == "country.life_satisfaction")
        assert satisfaction["unit"] == "ladder_points"

    async def test_every_scored_attribute_names_its_pillar(self, api: httpx.AsyncClient) -> None:
        """Null is for descriptive attributes, which are never scored (`reqs.md` 3.3). None
        ships today, and a criterion could not attach to one anyway (migration `0106`)."""
        body = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        assert all(attribute["pillar"] for attribute in body["items"])

    async def test_narrowing_by_level_excludes_the_others(self, api: httpx.AsyncClient) -> None:
        everything = (await api.get("/v1/attributes")).json()
        country_only = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()

        assert len(country_only["items"]) <= len(everything["items"])
        assert all(a["level"] == COUNTRY for a in country_only["items"])
