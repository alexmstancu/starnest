"""Duplicating a criteria set: how a user gets one they may change.

Gate A step 3. `reqs.md` Q191: a copy is a **full** copy, never a sparse overlay -- "inherit
from the default for anything not overridden" cannot hold, because weights sum to 100 within a
pillar and an override that did not move its siblings would sum to 118.

This is also what makes leaving `local_employment` exactly as seeded safe: nobody has to edit
the shipped set to try something.
"""

import httpx
import pytest

pytestmark = pytest.mark.acceptance

MINIMAL = "minimal"


class TestDuplicating:
    async def test_the_copy_carries_every_criterion_of_the_original(
        self, api: httpx.AsyncClient
    ) -> None:
        """A copy with fewer criteria is a copy that will score differently."""
        original = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()

        created = await api.post(
            f"/v1/criteria-sets/{MINIMAL}/duplicate",
            json={"id": "a_copy", "name": "A copy"},
        )
        try:
            assert created.status_code == 201
            copy = (await api.get("/v1/criteria-sets/a_copy")).json()
            assert {c["attribute"] for c in copy["criteria"]} == {
                c["attribute"] for c in original["criteria"]
            }
        finally:
            await api.delete("/v1/criteria-sets/a_copy")

    async def test_the_copy_carries_the_pillar_weights_too(self, api: httpx.AsyncClient) -> None:
        """Criteria without their pillar weights is a set that cannot add up."""
        await api.post(
            f"/v1/criteria-sets/{MINIMAL}/duplicate",
            json={"id": "a_weighted_copy", "name": "A weighted copy"},
        )
        try:
            copy = (await api.get("/v1/criteria-sets/a_weighted_copy")).json()

            assert {w["pillar"]: w["weight"] for w in copy["pillar_weights"]} == {
                "housing": 60,
                "culture": 40,
            }
        finally:
            await api.delete("/v1/criteria-sets/a_weighted_copy")

    async def test_changing_the_copy_leaves_the_original_alone(
        self, api: httpx.AsyncClient
    ) -> None:
        """The whole point. A user tries something without touching what ships."""
        await api.post(
            f"/v1/criteria-sets/{MINIMAL}/duplicate",
            json={"id": "an_edited_copy", "name": "An edited copy"},
        )
        try:
            await api.patch(
                "/v1/criteria-sets/an_edited_copy/criteria/country.housing_cost_overburden_rate",
                json={"weight": 90},
            )

            original = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()
            overburden = next(
                c
                for c in original["criteria"]
                if c["attribute"] == "country.housing_cost_overburden_rate"
            )
            assert overburden["weight"] == 50
        finally:
            await api.delete("/v1/criteria-sets/an_edited_copy")

    async def test_duplicating_onto_an_identifier_already_taken_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """Silently overwriting a set somebody built would be the worst possible success."""
        response = await api.post(
            f"/v1/criteria-sets/{MINIMAL}/duplicate",
            json={"id": MINIMAL, "name": "Itself"},
        )

        assert response.status_code >= 400

    async def test_duplicating_a_set_that_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/criteria-sets/no_such_set/duplicate",
            json={"id": "orphan_copy", "name": "Orphan"},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
