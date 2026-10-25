"""Everything the Configure tab writes: criteria sets, pillar weights, rules and settings.

The rule that runs through all of it: **the interface holds no domain logic** (`arch.md` 8.1).
A weight change is sent as one number and answered with what the rebalance made of every weight
beside it, so the screen prints an outcome it did not compute.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import httpx
import pytest
from psycopg import AsyncConnection, errors
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import CriteriaSet
from starnest.storage import PostgresCriteriaStore

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MINIMAL = "minimal"
NEW_SET = "a_scratch_of_my_own"
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
DISCARDED = "throwaway"
EMPTY = "an_empty_legacy_set"


@pytest.fixture
async def criteria(database_url: str) -> AsyncIterator[PostgresCriteriaStore]:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        yield PostgresCriteriaStore(pool)


@pytest.fixture
async def a_new_set(api: httpx.AsyncClient, criteria: PostgresCriteriaStore):
    """Purged rather than deleted afterwards: a deleted set keeps its id (P1-28), and four tests
    make this one in turn."""
    created = await api.post("/v1/criteria-sets", json={"id": NEW_SET, "name": "Mine"})
    assert created.status_code == 201
    yield created.json()
    await criteria.purge_criteria_set(NEW_SET)


class TestCriteriaSets:
    async def test_an_empty_set_scores_nothing_and_says_so(
        self, api: httpx.AsyncClient, criteria: PostgresCriteriaStore
    ) -> None:
        """Rather than producing a ranking out of an empty opinion. Create copies the default
        now (PL-034), so such a set is one stored before it did, built through the store."""
        await criteria.create_criteria_set(CriteriaSet(id=EMPTY, name="Empty"))
        try:
            await api.put("/v1/settings", json={"score_scale_max": 100})

            response = await api.get(
                "/v1/rankings", params={"criteria_set": EMPTY, "level": COUNTRY}
            )
        finally:
            await criteria.purge_criteria_set(EMPTY)

        body = response.json()
        assert (response.status_code, body["code"]) == (422, "cannot_be_ranked")
        assert body["details"] == {"reason": "scores_nothing"}

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

    async def test_a_set_can_be_discarded_and_restored(
        self, api: httpx.AsyncClient, criteria: PostgresCriteriaStore
    ) -> None:
        made = await api.post("/v1/criteria-sets", json={"id": DISCARDED, "name": "Throwaway"})
        try:
            deleted = await api.delete(f"/v1/criteria-sets/{DISCARDED}")
            gone = await api.get(f"/v1/criteria-sets/{DISCARDED}")
            restored = await api.post(f"/v1/criteria-sets/{DISCARDED}/restore")
        finally:
            await criteria.purge_criteria_set(DISCARDED)

        assert (deleted.status_code, gone.status_code) == (204, 404)
        assert restored.json() == made.json()

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


class TestASetWhoseWeightsCannotBeRenormalised:
    """Exclusions can leave weight with nowhere to go, and the refusal says where (PL-006).

    Both arranged through the API the Configure tab uses, because that is how a household gets
    here: the weight is moved onto what is then unticked.
    """

    HOUSING = "housing"

    async def test_a_pillar_whose_scored_criteria_weigh_nothing_is_named(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100})
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}"
        assert (await api.patch(path, json={"weight": 100})).status_code == 200
        assert (await api.patch(path, json={"is_scored": False})).status_code == 200

        body = await _the_refusal_to_rank(api, a_scratch_criteria_set)

        assert body["details"] == {"reason": "criteria_without_weight", "pillars": [self.HOUSING]}

    async def test_scoring_pillars_that_weigh_nothing_are_named(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100})
        base = f"/v1/criteria-sets/{a_scratch_criteria_set}"
        moved = await api.put(f"{base}/pillar-weights/{self.HOUSING}", json={"weight": 100})
        assert moved.status_code == 200
        criteria = (await api.get(base)).json()["criteria"]
        for criterion in criteria:
            if criterion["pillar"] == self.HOUSING:
                unticked = await api.patch(
                    f"{base}/criteria/{criterion['attribute']}", json={"is_scored": False}
                )
                assert unticked.status_code == 200

        body = await _the_refusal_to_rank(api, a_scratch_criteria_set)

        still_scoring = sorted({c["pillar"] for c in criteria if c["pillar"] != self.HOUSING})
        assert body["details"] == {"reason": "pillars_without_weight", "pillars": still_scoring}


async def _the_refusal_to_rank(api: httpx.AsyncClient, criteria_set: str) -> dict:
    response = await api.get(
        "/v1/rankings", params={"criteria_set": criteria_set, "level": COUNTRY}
    )
    body = response.json()
    assert (response.status_code, body["code"]) == (422, "cannot_be_ranked")
    return body


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

        applied = await api.put(path, json={"is_applied": True})
        after = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        dropped = await api.put(path, json={"is_applied": False})
        without = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        assert applied.status_code == 204
        assert dropped.status_code == 204
        assert "cheap_but_taxed" in after["applied_compound_rules"]
        assert "cheap_but_taxed" not in without["applied_compound_rules"]

    async def test_a_gate_the_catalog_does_not_have_is_a_404(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """**Not a 500** (P67). The stored column is a foreign key and nothing translated its
        violation, so naming a gate that does not exist reached the driver and was reported as
        a fault in the server -- for a request that is merely wrong."""
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/no_such_gate",
            json={"is_enforced": True},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    async def test_a_compound_rule_the_catalog_does_not_have_is_a_404(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/compound-rules/no_such_rule",
            json={"is_applied": True},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    async def test_releasing_a_gate_that_does_not_exist_is_refused_too(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Releasing an unknown gate would otherwise answer 204 for a no-op, which reads as
        confirmation that a gate nobody has was switched off."""
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/no_such_gate",
            json={"is_enforced": False},
        )

        assert response.status_code == 404


class TestSettings:
    async def test_the_five_are_replaced_whole_and_returned(self, api: httpx.AsyncClient) -> None:
        response = await api.put(
            "/v1/settings",
            json={
                "min_coverage": 60,
                "score_scale_max": 100,
                "comparator_limit": 5,
                "run_spend_cap_eur": 10,
                "refetch_older_than_days": 365,
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "min_coverage": 60,
            "score_scale_max": 100,
            "comparator_limit": 5,
            "run_spend_cap_eur": 10,
            "refetch_older_than_days": 365,
        }

    async def test_an_unset_refetch_age_refetches_everything(self, api: httpx.AsyncClient) -> None:
        """The shipped state, and exactly what the planner did before the setting existed."""
        await api.put("/v1/settings", json={"score_scale_max": 100})

        assert (await api.get("/v1/settings")).json()["refetch_older_than_days"] is None

    async def test_a_null_stays_null_rather_than_taking_a_default(
        self, api: httpx.AsyncClient
    ) -> None:
        """An unset setting is a decision the household has not made, and substituting a value
        here would be this application choosing what "enough coverage" means."""
        await api.put("/v1/settings", json={"score_scale_max": 100})

        stored = (await api.get("/v1/settings")).json()
        assert stored["min_coverage"] is None
        assert stored["comparator_limit"] is None


class TestAScoreRangeBelowAnAnchor:
    """A criterion anchors a figure to a score, and the score range has to reach it (PL-006).

    Refused when either side is saved, so the conflict is named where it is made rather than
    surfacing later on Rank as ids. **Only what the request changes is refused** (P1-04, N7): a
    range or an anchor already stored out of step -- by a migration, or before this check
    existed -- would otherwise block every save beside it, whatever the household meant to
    change. Rank refuses that state instead, and names it.
    """

    A_RANGE_BELOW_THE_SHIPPED_ANCHORS = 10
    """The shipped sets anchor figures to scores of up to 100."""

    async def test_a_changed_range_below_an_anchor_is_refused_naming_the_lowest_that_fits(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.put(
            "/v1/settings", json={"score_scale_max": self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS}
        )

        body = response.json()
        assert (response.status_code, body["code"]) == (409, "score_scale_below_anchors")
        assert set(body["details"]) == {"minimum", "criteria_set", "attribute"}
        assert body["details"]["minimum"] == 100
        assert await _the_highest_anchor_of(api, body["details"]) == 100

    async def test_a_refused_range_is_not_stored(self, api: httpx.AsyncClient) -> None:
        await api.put(
            "/v1/settings", json={"score_scale_max": self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS}
        )

        assert (await api.get("/v1/settings")).json()["score_scale_max"] is None

    async def test_a_stored_range_below_an_anchor_does_not_block_another_setting(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        await _store_past_the_check(database_url, self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS)

        response = await api.put(
            "/v1/settings",
            json={"score_scale_max": self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS, "comparator_limit": 5},
        )

        assert response.status_code == 200
        assert response.json()["comparator_limit"] == 5

    async def test_a_stored_range_below_an_anchor_is_explained_when_ranking(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """What a migration can still leave behind, said in fields a client can word."""
        await _store_past_the_check(database_url, self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS)

        response = await api.get(
            "/v1/rankings", params={"criteria_set": "local_employment", "level": COUNTRY}
        )

        body = response.json()
        assert (response.status_code, body["code"]) == (422, "invalid_criterion")
        assert body["details"]["reason"] == "anchor_above_scale"
        assert body["details"]["score_scale_max"] == self.A_RANGE_BELOW_THE_SHIPPED_ANCHORS

    async def test_an_anchor_above_the_range_is_refused_when_it_is_saved(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100})

        response = await _anchor_overburden_up_to(api, a_scratch_criteria_set, 150)

        body = response.json()
        assert (response.status_code, body["code"]) == (422, "invalid_criterion")
        assert body["details"] == {
            "reason": "anchor_above_scale",
            "attribute": OVERBURDEN,
            "anchor_score": 150,
            "score_scale_max": 100,
        }

    async def test_a_refused_anchor_is_not_stored(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100})
        before = await _the_anchors_of_overburden(api, a_scratch_criteria_set)

        await _anchor_overburden_up_to(api, a_scratch_criteria_set, 150)

        assert await _the_anchors_of_overburden(api, a_scratch_criteria_set) == before

    async def test_an_anchor_stored_above_the_range_does_not_block_an_unrelated_change(
        self, api: httpx.AsyncClient, database_url: str, a_scratch_criteria_set: str
    ) -> None:
        await _an_anchor_stored_above_the_range(api, database_url, a_scratch_criteria_set)

        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERCROWDING}",
            json={"weight": 60},
        )

        assert response.status_code == 200

    @pytest.mark.parametrize("reordered", [False, True], ids=["as stored", "reordered"])
    async def test_anchors_sent_back_unchanged_do_not_block_the_rest_of_the_rule(
        self,
        api: httpx.AsyncClient,
        database_url: str,
        a_scratch_criteria_set: str,
        reordered: bool,
    ) -> None:
        """The rule form sends every anchor with each save, so an anchor it only sends back is
        not one this request writes -- as a range equal to the stored one is not refused."""
        await _an_anchor_stored_above_the_range(api, database_url, a_scratch_criteria_set)
        unchanged = await _the_anchors_of_overburden(api, a_scratch_criteria_set)

        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "normalisation_method": "fixed",
                "blocks_if_missing": True,
                "scale_anchors": unchanged[::-1] if reordered else unchanged,
            },
        )

        assert response.status_code == 200

    async def test_a_range_changed_while_an_anchor_is_written_is_refused_after_it(
        self,
        api: httpx.AsyncClient,
        database_url: str,
        wait_until_blocked: Callable[..., Awaitable[int]],
        a_scratch_criteria_set: str,
    ) -> None:
        """Two tabs (review of PL-006): the anchor is written under the old range, so the range
        that commits after it has to meet it. Unserialised, the anchor read 200, the range wrote
        100 meanwhile, both answered 200 and Rank met a set it could not score."""
        await api.put("/v1/settings", json={"score_scale_max": 200})

        async with _a_held_lock(database_url, _THE_SET, (a_scratch_criteria_set,)) as holder:
            anchor = asyncio.create_task(_anchor_overburden_up_to(api, a_scratch_criteria_set, 150))
            anchoring = await wait_until_blocked(anchor, on={holder})
            scale = asyncio.create_task(api.put("/v1/settings", json={"score_scale_max": 100}))
            await wait_until_blocked(scale, on={anchoring})

        anchored, rescaled = await asyncio.gather(anchor, scale)
        assert anchored.status_code == 200
        assert (rescaled.status_code, rescaled.json().get("details")) == (
            409,
            {"minimum": 150, "criteria_set": a_scratch_criteria_set, "attribute": OVERBURDEN},
        )
        assert (await api.get("/v1/settings")).json()["score_scale_max"] == 200

    async def test_an_anchor_written_while_the_range_changes_is_refused_after_it(
        self,
        api: httpx.AsyncClient,
        database_url: str,
        wait_until_blocked: Callable[..., Awaitable[int]],
        a_scratch_criteria_set: str,
    ) -> None:
        """The other order: the range is checked against the anchors as they stand, so the
        anchor that commits after it has to meet the new range."""
        await api.put("/v1/settings", json={"score_scale_max": 200})
        before = await _the_anchors_of_overburden(api, a_scratch_criteria_set)

        async with _a_held_lock(database_url, _THE_SETTINGS, ()) as holder:
            scale = asyncio.create_task(api.put("/v1/settings", json={"score_scale_max": 100}))
            rescaling = await wait_until_blocked(scale, on={holder})
            anchor = asyncio.create_task(_anchor_overburden_up_to(api, a_scratch_criteria_set, 150))
            await wait_until_blocked(anchor, on={holder, rescaling})

        rescaled, anchored = await asyncio.gather(scale, anchor)
        assert rescaled.status_code == 200
        assert (anchored.status_code, anchored.json().get("details")) == (
            422,
            {
                "reason": "anchor_above_scale",
                "attribute": OVERBURDEN,
                "anchor_score": 150,
                "score_scale_max": 100,
            },
        )
        assert await _the_anchors_of_overburden(api, a_scratch_criteria_set) == before

    async def test_a_range_changed_while_a_set_is_restored_is_refused_after_it(
        self,
        api: httpx.AsyncClient,
        database_url: str,
        wait_until_blocked: Callable[..., Awaitable[int]],
        a_scratch_criteria_set: str,
    ) -> None:
        """A restore shares the range before it locks its set (PL-006, PL-033), so a range
        changed meanwhile waits for it, and then meets the anchors it brought back."""
        await api.put("/v1/settings", json={"score_scale_max": 200})
        assert (await _anchor_overburden_up_to(api, a_scratch_criteria_set, 150)).status_code == 200
        assert (await api.delete(f"/v1/criteria-sets/{a_scratch_criteria_set}")).status_code == 204

        async with _a_held_lock(database_url, _THE_SET, (a_scratch_criteria_set,)) as holder:
            restore = asyncio.create_task(
                api.post(f"/v1/criteria-sets/{a_scratch_criteria_set}/restore")
            )
            restoring = await wait_until_blocked(restore, on={holder})
            assert await _the_settings_are_held(database_url), "the restore waits, range unheld"
            scale = asyncio.create_task(api.put("/v1/settings", json={"score_scale_max": 100}))
            await wait_until_blocked(scale, on={restoring})

        restored, rescaled = await asyncio.gather(restore, scale)
        assert restored.status_code == 200
        assert (rescaled.status_code, rescaled.json().get("details")) == (
            409,
            {"minimum": 150, "criteria_set": a_scratch_criteria_set, "attribute": OVERBURDEN},
        )
        assert (await api.get("/v1/settings")).json()["score_scale_max"] == 200


_THE_SET = "SELECT id FROM criteria_set WHERE id = %s FOR UPDATE"
_THE_SETTINGS = "SELECT id FROM settings WHERE id = 1 FOR UPDATE"
"""A row held by the test itself, so the request under test stops at it and is seen waiting."""


@asynccontextmanager
async def _a_held_lock(database_url: str, statement: str, parameters: tuple) -> AsyncIterator[int]:
    """One row held by a transaction of its own until the block exits; yields its backend pid."""
    async with await AsyncConnection.connect(database_url) as holder:
        await holder.execute(statement, parameters)
        try:
            yield holder.info.backend_pid
        finally:
            await holder.rollback()


async def _the_settings_are_held(database_url: str) -> bool:
    """Whether another transaction holds the settings row, `FOR SHARE` included."""
    async with await AsyncConnection.connect(database_url, autocommit=True) as probing:
        try:
            await probing.execute("SELECT 1 FROM settings WHERE id = 1 FOR UPDATE NOWAIT")
        except errors.LockNotAvailable:
            return True
    return False


async def _the_highest_anchor_of(api: httpx.AsyncClient, named: dict) -> int:
    """The highest score the criterion a refusal names anchors a figure to."""
    criteria_set = (await api.get(f"/v1/criteria-sets/{named['criteria_set']}")).json()
    criterion = next(c for c in criteria_set["criteria"] if c["attribute"] == named["attribute"])
    return max(anchor["score"] for anchor in criterion["scale_anchors"])


async def _the_anchors_of_overburden(api: httpx.AsyncClient, criteria_set: str) -> list[dict]:
    body = (await api.get(f"/v1/criteria-sets/{criteria_set}")).json()
    return next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)["scale_anchors"]


async def _store_past_the_check(database_url: str, score_scale_max: int) -> None:
    """A range written by SQL, as a migration or an older build could have left it."""
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
                (score_scale_max,),
            )


async def _an_anchor_stored_above_the_range(
    api: httpx.AsyncClient, database_url: str, criteria_set: str
) -> None:
    """Overburden anchored to 150 under a range of 100: the state a migration can leave.

    Anchored while no range is set, which nothing checks, then the range written past the check.
    """
    anchored = await _anchor_overburden_up_to(api, criteria_set, 150)
    assert anchored.status_code == 200, "the arrangement needs the anchor stored"
    await _store_past_the_check(database_url, 100)


async def _anchor_overburden_up_to(
    api: httpx.AsyncClient, criteria_set: str, top_score: int
) -> httpx.Response:
    return await api.patch(
        f"/v1/criteria-sets/{criteria_set}/criteria/{OVERBURDEN}",
        json={
            "normalisation_method": "fixed",
            "scale_anchors": [
                {"input_value": 0, "score": top_score},
                {"input_value": 50, "score": 0},
            ],
        },
    )


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
            # From the catalog, so the interface never has to map a name to a flag.
            "country_code": "PT",
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
