"""Keeping a ranking and reading it back (`reqs.md` 3.4a, Q155, Q156).

A ranking is computed on demand and stored only when somebody keeps it. What makes a kept one
worth keeping is the frozen criteria beside it: the set stays editable, so without the snapshot
the numbers would drift out of meaning the next time a weight moved.
"""

import httpx
import pytest

pytestmark = pytest.mark.acceptance

MINIMAL = "minimal"
COUNTRY = "country"
PORTUGAL = "country.portugal"


async def _keep_one(api: httpx.AsyncClient, note: str = "a keeper") -> dict:
    response = await api.post(
        "/v1/evaluations", json={"criteria_set": MINIMAL, "level": COUNTRY, "note": note}
    )
    assert response.status_code == 201
    return response.json()


class TestKeepingARanking:
    async def test_it_carries_the_scale_the_scores_were_computed_on(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """Frozen with the scores: `settings.score_scale_max` is the household's and may
        change, and a score of 71 on a scale nobody recorded means nothing later."""
        kept = await _keep_one(api)

        assert kept["score_scale_max"] == 100
        assert kept["criteria_set"] == MINIMAL
        assert kept["note"] == "a keeper"

    async def test_the_kept_ranking_reads_back_in_its_own_order(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        live = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()
        stored = (await api.get(f"/v1/evaluations/{kept['id']}")).json()

        assert [c["candidate"] for c in stored["candidates"]] == [
            c["candidate"] for c in live["candidates"]
        ]
        assert [c["score"] for c in stored["candidates"]] == [
            c["score"] for c in live["candidates"]
        ]

    async def test_the_unscoreable_are_kept_too(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """Never filtered out: the reason a candidate is out is a thing the product exists to
        show (`reqs.md` 5.4)."""
        kept = await _keep_one(api)

        stored = (await api.get(f"/v1/evaluations/{kept['id']}")).json()

        assert any(c["score"] is None for c in stored["candidates"])
        assert all(c["name"] for c in stored["candidates"])

    async def test_it_appears_in_the_list_newest_first(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        first = await _keep_one(api, note="first")
        second = await _keep_one(api, note="second")

        listed = (await api.get("/v1/evaluations")).json()

        assert [item["id"] for item in listed["items"]][:2] == [second["id"], first["id"]]

    async def test_reading_a_ranking_still_stores_nothing(
        self, api: httpx.AsyncClient, stored_figures: None, database_url: str
    ) -> None:
        """`GET /rankings` is the slider moving; an afternoon of tuning must not bury the few
        results worth keeping (`reqs.md` Q155)."""
        await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})

        assert (await api.get("/v1/evaluations")).json()["items"] == []


class TestWhatTheSnapshotFreezes:
    async def test_the_criteria_come_back_with_their_weights_and_anchors(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        frozen = (await api.get(f"/v1/evaluations/{kept['id']}/criteria")).json()

        assert sum(w["weight"] for w in frozen["pillar_weights"]) == 100
        assert all(c["attribute"] and c["goal"] for c in frozen["criteria"])

    async def test_changing_the_live_weights_afterwards_leaves_it_alone(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        """The whole point of the snapshot (`reqs.md` Q156)."""
        kept = await api.post(
            "/v1/evaluations", json={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        )
        before = (await api.get(f"/v1/evaluations/{kept.json()['id']}/criteria")).json()

        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria"
            "/country.housing_cost_overburden_rate",
            json={"weight": 70},
        )

        after = (await api.get(f"/v1/evaluations/{kept.json()['id']}/criteria")).json()
        assert after == before


class TestTheDrillDownOnALiveRanking:
    """The same question, asked of a ranking nobody saved.

    **The numbers behind a score must be reachable without keeping the ranking.** Saving is a
    decision about what to keep; reading why a candidate scored what it scored is a step in
    looking at it. Before this the only drill-down took an evaluation id, so the screen could
    show the figures only after the reader had committed to a snapshot.
    """

    async def test_it_agrees_with_the_saved_evaluation_it_was_computed_the_same_way_as(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """**The two paths are one computation or they are two answers to one question.** A
        drill-down that read differently depending on whether the ranking had been saved would
        make the act of saving change the figures, which is the opposite of what freezing is
        for."""
        kept = await _keep_one(api)
        saved = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        live = (
            await api.get(
                f"/v1/rankings/candidates/{PORTUGAL}",
                params={"criteria_set": MINIMAL, "level": COUNTRY},
            )
        ).json()

        assert live["candidate"] == saved["candidate"]
        assert live["score"] == saved["score"]
        assert live["attribute_scores"] == saved["attribute_scores"]

    async def test_the_contributions_add_up_to_the_score(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """A total nobody can take apart is a number this application may not show."""
        live = (
            await api.get(
                f"/v1/rankings/candidates/{PORTUGAL}",
                params={"criteria_set": MINIMAL, "level": COUNTRY},
            )
        ).json()

        assert round(sum(row["contribution"] for row in live["attribute_scores"])) == live["score"]

    async def test_it_stores_nothing(self, api: httpx.AsyncClient, stored_figures: None) -> None:
        """Like the ranking it drills into (`reqs.md` 5.6, Q155). An afternoon of reading must
        not fill the saved list with snapshots nobody asked for."""
        before = (await api.get("/v1/evaluations")).json()["items"]

        await api.get(
            f"/v1/rankings/candidates/{PORTUGAL}",
            params={"criteria_set": MINIMAL, "level": COUNTRY},
        )

        assert (await api.get("/v1/evaluations")).json()["items"] == before

    async def test_a_candidate_the_level_does_not_hold_is_a_404(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        response = await api.get(
            "/v1/rankings/candidates/country.atlantis",
            params={"criteria_set": MINIMAL, "level": COUNTRY},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "candidate_not_found"

    async def test_a_criteria_set_nobody_made_is_a_404(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """**The named resource is read first**, as the ranking itself does: asked about a set
        that does not exist, a 409 about the score scale would send a reader to change a
        setting that was never the problem."""
        response = await api.get(
            f"/v1/rankings/candidates/{PORTUGAL}",
            params={"criteria_set": "no_such_set", "level": COUNTRY},
        )

        assert response.status_code == 404


class TestTheDrillDown:
    async def test_it_explains_the_total_attribute_by_attribute(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        detail = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        assert detail["candidate"] == PORTUGAL
        assert detail["attribute_scores"]
        scored = [row for row in detail["attribute_scores"] if row["normalised_score"] is not None]
        assert scored, "Portugal was scored, so something must explain its total"
        assert all(row["effective_weight"] >= 0 for row in detail["attribute_scores"])

    async def test_the_contributions_add_up_to_the_score(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """A total nobody can take apart is a number this application may not show."""
        kept = await _keep_one(api)

        detail = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        assert (
            round(sum(row["contribution"] for row in detail["attribute_scores"]))
            == (detail["score"])
        )

    @pytest.mark.parametrize(
        "path",
        [
            "/v1/evaluations/999999",
            "/v1/evaluations/999999/criteria",
            "/v1/evaluations/999999/candidates/country.portugal",
        ],
        ids=["the ranking", "the criteria", "the drill-down"],
    )
    async def test_an_evaluation_nobody_kept_is_a_404(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        assert (await api.get(path)).status_code == 404

    async def test_a_candidate_the_evaluation_never_scored_is_a_404(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        response = await api.get(f"/v1/evaluations/{kept['id']}/candidates/country.atlantis")

        assert response.status_code == 404
