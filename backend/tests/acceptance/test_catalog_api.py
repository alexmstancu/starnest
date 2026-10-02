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

        assert len(body["items"]) == 42

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
        # **No 3-month horizon any more.** It belonged only to the two job-posting counts,
        # whose whole problem was that they measured a flow fast enough to need one -- and
        # `0487` retired them. What is left ages over a year or more.
        assert horizons == {12, 24, 60, 72}

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


class TestSwitchingASourceOff:
    """Whether a source is consulted is a judgement the household makes (`reqs.md` 2, Q232).

    **Every test here puts the source back**, because these run against a real database and a
    source left switched off would change every ranking the rest of the suite reads.
    """

    SOURCE = "numbeo"

    async def _restore(self, api: httpx.AsyncClient) -> None:
        await api.patch(f"/v1/data-sources/{self.SOURCE}", json={"is_enabled": True})

    async def test_a_source_reports_whether_it_is_consulted(self, api: httpx.AsyncClient) -> None:
        body = (await api.get("/v1/data-sources")).json()

        assert all("is_enabled" in source for source in body["items"])

    async def test_switching_one_off_is_read_back(self, api: httpx.AsyncClient) -> None:
        try:
            answer = await api.patch(f"/v1/data-sources/{self.SOURCE}", json={"is_enabled": False})

            assert answer.status_code == 200
            assert answer.json()["is_enabled"] is False

            listed = (await api.get("/v1/data-sources")).json()["items"]
            assert next(s for s in listed if s["id"] == self.SOURCE)["is_enabled"] is False
        finally:
            await self._restore(api)

    async def test_the_switch_and_the_order_are_independent(self, api: httpx.AsyncClient) -> None:
        """Switching one off does not have to restate where it stands."""
        before = next(
            s for s in (await api.get("/v1/data-sources")).json()["items"] if s["id"] == self.SOURCE
        )["default_priority"]
        try:
            answer = await api.patch(f"/v1/data-sources/{self.SOURCE}", json={"is_enabled": False})

            assert answer.json()["default_priority"] == before
        finally:
            await self._restore(api)

    async def test_the_order_can_be_set_without_touching_the_switch(
        self, api: httpx.AsyncClient
    ) -> None:
        listed = (await api.get("/v1/data-sources")).json()["items"]
        before = next(s for s in listed if s["id"] == self.SOURCE)["default_priority"]
        try:
            answer = await api.patch(
                f"/v1/data-sources/{self.SOURCE}", json={"default_priority": before + 1}
            )

            assert answer.json()["default_priority"] == before + 1
            assert answer.json()["is_enabled"] is True
        finally:
            await api.patch(f"/v1/data-sources/{self.SOURCE}", json={"default_priority": before})

    async def test_a_source_the_catalog_does_not_hold_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        answer = await api.patch("/v1/data-sources/no_such_source", json={"is_enabled": False})

        # **404, like every other named resource that is not there** (P93). This answered 422
        # alone among the endpoints that address a thing by id -- 422 says the request was
        # understood and its content refused, which is the wrong story for a path pointing at
        # nothing. `UnknownDataSourceError` is still 422 and still right: `rules.py` raises it
        # for a source named in a request *body*.
        assert answer.status_code == 404
        assert answer.json()["code"] == "not_found"

    async def test_nothing_else_about_a_source_may_be_changed(self, api: httpx.AsyncClient) -> None:
        """What a source *is* stays catalog, changed by migration (`arch.md` 1.2)."""
        answer = await api.patch(f"/v1/data-sources/{self.SOURCE}", json={"name": "Something else"})

        assert answer.status_code == 422
