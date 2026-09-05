"""The household: who is moving, and the figures every affordability question turns on.

`reqs.md` 3.9, and Gate A's first step. One record, no identifier, because there is one user
running locally -- the schema says so with `CHECK (id = 1)` and the API agrees by having nowhere
to put one.
"""

import httpx
import pytest

from .conftest import A_HOUSEHOLD

pytestmark = pytest.mark.acceptance


class TestBeforeOneIsConfigured:
    async def test_reading_a_household_nobody_has_configured_says_so(
        self, api: httpx.AsyncClient
    ) -> None:
        """Not an empty household. Income, size and home country have no honest empty value,
        and inventing one would make every affordability figure quietly wrong."""
        response = await api.get("/v1/household")

        assert response.status_code == 404
        assert response.json()["code"] == "household_not_configured"


class TestStoringOne:
    async def test_it_is_stored_and_read_back(self, api: httpx.AsyncClient) -> None:
        stored = await api.put("/v1/household", json=A_HOUSEHOLD)
        read_back = await api.get("/v1/household")

        assert stored.status_code == 200
        assert read_back.status_code == 200
        assert read_back.json() == stored.json()

    async def test_the_response_is_what_was_stored_rather_than_what_was_sent(
        self, api: httpx.AsyncClient
    ) -> None:
        """The domain normalises: citizenships are a set, so duplicates collapse. A client that
        assumed its request body was the stored state would be wrong with nothing telling it."""
        response = await api.put(
            "/v1/household",
            json={**A_HOUSEHOLD, "citizenships": ["country.romania", "country.romania"]},
        )

        assert response.json()["citizenships"] == ["country.romania"]

    async def test_replacing_it_replaces_it_whole(self, api: httpx.AsyncClient) -> None:
        """A change must reach criterion defaults, cross-attribute warnings and match rules at
        once (`reqs.md` 3.9). A whole-record write is what makes that one event."""
        await api.put("/v1/household", json=A_HOUSEHOLD)

        await api.put(
            "/v1/household",
            json={**A_HOUSEHOLD, "net_income": 7000, "target_monthly_spend": None},
        )

        body = (await api.get("/v1/household")).json()
        assert body["net_income"] == 7000
        assert body["target_monthly_spend"] is None

    async def test_the_optional_figures_may_be_left_out(self, api: httpx.AsyncClient) -> None:
        """`target_monthly_spend` and `max_rent` are provisional (`reqs.md` 3.10). Absent is a
        decision not yet made, not a fault."""
        minimal = {
            key: value
            for key, value in A_HOUSEHOLD.items()
            if key not in {"target_monthly_spend", "max_rent"}
        }

        response = await api.put("/v1/household", json=minimal)

        assert response.status_code == 200
        assert response.json()["max_rent"] is None


class TestWhatAHouseholdMayNotBe:
    async def test_a_household_with_no_adult_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put("/v1/household", json={**A_HOUSEHOLD, "number_adults": 0})

        assert response.status_code == 422

    async def test_a_negative_number_of_children_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put("/v1/household", json={**A_HOUSEHOLD, "number_children": -1})

        assert response.status_code == 422

    async def test_a_household_with_no_citizenship_is_refused(self, api: httpx.AsyncClient) -> None:
        """At least one is required: `eu_free_movement` and the UK and Swiss gates all turn on
        it (`reqs.md` 7.3), and an empty set would make every such gate pass or fail silently
        rather than visibly."""
        response = await api.put("/v1/household", json={**A_HOUSEHOLD, "citizenships": []})

        assert response.status_code == 422

    async def test_a_home_country_that_is_not_a_candidate_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """Romania is both baseline and candidate (`reqs.md` Q30), so "stay put" is measurable.
        A home country outside the candidate set could not be scored beside the others."""
        response = await api.put(
            "/v1/household", json={**A_HOUSEHOLD, "home_country_candidate": "country.narnia"}
        )

        assert response.status_code in {404, 422}
