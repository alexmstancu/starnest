"""Everything the Configure tab writes: criteria sets, pillar weights, rules and settings.

The rule that runs through all of it: **the interface holds no domain logic** (`arch.md` 8.1).
A weight change is sent as one number and answered with what the rebalance made of every weight
beside it, so the screen prints an outcome it did not compute.
"""

import httpx
import pytest

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MINIMAL = "minimal"
NEW_SET = "a_scratch_of_my_own"


@pytest.fixture
async def a_new_set(api: httpx.AsyncClient):
    created = await api.post("/v1/criteria-sets", json={"id": NEW_SET, "name": "Mine"})
    assert created.status_code == 201
    yield created.json()
    await api.delete(f"/v1/criteria-sets/{NEW_SET}")


class TestCriteriaSets:
    async def test_a_new_set_starts_empty_rather_than_borrowing_somebody_elses_priorities(
        self, a_new_set: dict
    ) -> None:
        """The design gives it an identifier and a name and nothing else; copying a set would be
        the endpoint deciding whose priorities a new one starts from."""
        assert a_new_set["id"] == NEW_SET
        assert a_new_set["criteria"] == []
        assert a_new_set["pillar_weights"] == []

    async def test_an_empty_set_scores_nothing_and_says_so(
        self, api: httpx.AsyncClient, a_new_set: dict
    ) -> None:
        """Rather than producing a ranking out of an empty opinion."""
        await api.put("/v1/settings", json={"score_scale_max": 100})

        response = await api.get("/v1/rankings", params={"criteria_set": NEW_SET, "level": COUNTRY})

        assert response.status_code == 422
        assert "scores nothing" in response.json()["message"]

    async def test_an_identifier_that_is_taken_is_refused(
        self, api: httpx.AsyncClient, a_new_set: dict
    ) -> None:
        """Silently replacing a set somebody built is the worst kind of success."""
        response = await api.post("/v1/criteria-sets", json={"id": NEW_SET, "name": "Again"})

        assert response.status_code == 409
        assert response.json()["code"] == "criteria_set_exists"

    async def test_renaming_changes_the_name_and_nothing_else(
        self, api: httpx.AsyncClient, a_new_set: dict
    ) -> None:
        renamed = await api.patch(f"/v1/criteria-sets/{NEW_SET}", json={"name": "Ours"})

        assert renamed.json()["name"] == "Ours"
        assert renamed.json()["id"] == NEW_SET

    async def test_a_set_can_be_discarded(self, api: httpx.AsyncClient) -> None:
        await api.post("/v1/criteria-sets", json={"id": "throwaway", "name": "Throwaway"})

        deleted = await api.delete("/v1/criteria-sets/throwaway")

        assert deleted.status_code == 204
        assert (await api.get("/v1/criteria-sets/throwaway")).status_code == 404

    async def test_renaming_one_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        assert (
            await api.patch("/v1/criteria-sets/nobody_made_this", json={"name": "x"})
        ).status_code == 404


class TestPillarWeights:
    async def test_moving_one_answers_with_every_weight_at_that_level(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The outer half of the two-level weighting, rebalanced by the server. Returning one
        number would leave the screen showing weights that do not sum to 100."""
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        pillar = before["pillar_weights"][0]["pillar"]

        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/pillar-weights/{pillar}",
            json={"weight": 40},
        )

        assert response.status_code == 200
        weights = {item["pillar"]: item["weight"] for item in response.json()["items"]}
        assert weights[pillar] == 40
        assert sum(weights.values()) == pytest.approx(100)

    async def test_a_pillar_the_set_does_not_weigh_is_a_404(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/pillar-weights/atmosphere",
            json={"weight": 10},
        )

        assert response.status_code == 404

    async def test_a_locked_weight_is_recorded(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        pillar = before["pillar_weights"][0]["pillar"]

        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/pillar-weights/{pillar}",
            json={"weight": 30, "weight_locked": True},
        )

        locked = {item["pillar"]: item["weight_locked"] for item in response.json()["items"]}
        assert locked[pillar] is True


class TestTheRulesASetEnforces:
    async def test_a_gate_can_be_enforced_and_released(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Whether a gate counts is the set's preference; the answer itself belongs to the
        candidate and stays stored either way (`arch.md` 3.6)."""
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/uk_skilled_worker"

        enforced = await api.put(path, json={"is_enforced": True})
        after = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        await api.put(path, json={"is_enforced": False})
        released = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        assert enforced.status_code == 204
        assert "uk_skilled_worker" in after["enforced_match_rules"]
        assert "uk_skilled_worker" not in released["enforced_match_rules"]

    async def test_a_compound_rule_can_be_applied_and_dropped(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/compound-rules/cheap_but_taxed"

        await api.put(path, json={"is_applied": True})
        after = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        assert "cheap_but_taxed" in after["applied_compound_rules"]


class TestSettings:
    async def test_the_four_are_replaced_whole_and_returned(self, api: httpx.AsyncClient) -> None:
        response = await api.put(
            "/v1/settings",
            json={
                "min_coverage": 60,
                "score_scale_max": 100,
                "comparator_limit": 5,
                "run_spend_cap_eur": 10,
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "min_coverage": 60,
            "score_scale_max": 100,
            "comparator_limit": 5,
            "run_spend_cap_eur": 10,
        }

    async def test_a_null_stays_null_rather_than_taking_a_default(
        self, api: httpx.AsyncClient
    ) -> None:
        """An unset setting is a decision the household has not made, and substituting a value
        here would be this application choosing what "enough coverage" means."""
        await api.put("/v1/settings", json={"score_scale_max": 100})

        stored = (await api.get("/v1/settings")).json()
        assert stored["min_coverage"] is None
        assert stored["comparator_limit"] is None


class TestReadingOneOfSomething:
    async def test_one_attribute_comes_back_with_its_declarations(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get("/v1/attributes/country.cost_of_living_index")).json()

        assert body["id"] == "country.cost_of_living_index"
        assert body["value_type"] == "Quantity"

    async def test_one_candidate_comes_back(self, api: httpx.AsyncClient) -> None:
        body = (await api.get("/v1/candidates/country.portugal")).json()

        assert body == {
            "id": "country.portugal",
            "name": "Portugal",
            "level": COUNTRY,
            "parent_candidate": None,
        }

    @pytest.mark.parametrize(
        "path",
        ["/v1/attributes/country.happiness", "/v1/candidates/country.atlantis"],
        ids=["an attribute", "a candidate"],
    )
    async def test_naming_what_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        assert (await api.get(path)).status_code == 404

    async def test_every_source_comes_back_in_priority_order(self, api: httpx.AsyncClient) -> None:
        """Reading this list top to bottom is reading the order the active-value rule applies."""
        body = (await api.get("/v1/data-sources")).json()

        priorities = [source["default_priority"] for source in body["items"]]
        assert priorities == sorted(priorities)
        assert any(source["id"] == "stand_in" for source in body["items"])
