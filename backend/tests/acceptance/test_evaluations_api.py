"""Keeping a ranking and reading it back (`reqs.md` 3.4a, Q155, Q156).

A ranking is computed on demand and stored only when somebody keeps it. What makes a kept one
worth keeping is the frozen criteria beside it: the set stays editable, so without the snapshot
the numbers would drift out of meaning the next time a weight moved.
"""

import asyncio

import httpx
import psycopg
import pytest

from .conftest import A_HOUSEHOLD

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


class TestAKeptRankingKeepsItsScale:
    """A saved ranking shows its evidence, and the scale it was scored on is part of it (D46).

    The setting may move afterwards; the scores kept under it do not, so reading them against
    the current setting would draw every bar against a range they were never on (PL-062).
    """

    A_LATER_SCALE = 150

    async def test_a_kept_ranking_keeps_the_scale_it_was_frozen_with(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)
        moved = await api.put("/v1/settings", json={"score_scale_max": self.A_LATER_SCALE})
        assert moved.status_code == 200

        ranking = await api.get(f"/v1/evaluations/{kept['id']}")
        detail = await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")

        assert [ranking.json()["score_scale_max"], detail.json()["score_scale_max"]] == [
            kept["score_scale_max"]
        ] * 2
        assert kept["score_scale_max"] != self.A_LATER_SCALE


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

        # **Every field, not three of them.** This compared the candidate, the score and the
        # breakdown, and passed for months while `coverage_by_confidence` and
        # `insufficient_reason` were not stored at all -- a saved ranking showed an empty
        # confidence split and no sentence, and the test whose whole job is "these two paths
        # agree" was looking the other way (`0486`). Comparing the body is the assertion the
        # docstring already claimed to be making.
        assert live == saved

    async def test_weight_and_weight_used_are_on_one_basis(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """Both are shares of the whole level (PL-063, D21). A row with a figure was used at its
        weight or more, the excess being what missing figures handed on; a row with none keeps
        its weight and was used at nothing; and the weights are the whole level."""
        live = (
            await api.get(
                f"/v1/rankings/candidates/{PORTUGAL}",
                params={"criteria_set": MINIMAL, "level": COUNTRY},
            )
        ).json()
        rows = live["attribute_scores"]
        answered = [row for row in rows if row["normalised_score"] is not None]
        missing = [row for row in rows if row["normalised_score"] is None]
        coverage = live["coverage"] / 100

        assert round(sum(row["weight"] for row in rows), 6) == 100
        assert answered and missing
        for row in answered:
            assert row["effective_weight"] == pytest.approx(row["weight"] / coverage)
        assert all(row["weight"] > 0 and row["effective_weight"] == 0 for row in missing)

    async def test_the_saved_drill_down_weighs_by_the_frozen_criteria(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        """A weight moved after saving leaves the saved weights as they were."""
        kept = (
            await api.post(
                "/v1/evaluations", json={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
            )
        ).json()
        before = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        moved = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria"
            "/country.housing_cost_overburden_rate",
            json={"weight": 70},
        )
        assert moved.status_code == 200
        after = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        assert [row["weight"] for row in after["attribute_scores"]] == [
            row["weight"] for row in before["attribute_scores"]
        ]

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


class TestTheOrderARankingIsShownIn:
    """PL-066: the unranked follow by score, live and saved alike."""

    async def test_live_and_saved_agree_and_the_unranked_run_by_score(
        self, api: httpx.AsyncClient, database_url: str, a_scratch_criteria_set: str
    ) -> None:
        """A threshold excludes three candidates with different scores, two of them tied.

        *Mutation:* revert the key to `(rank is None, rank or 0)`, and the live order is id
        order and the saved one name order.
        """
        await _store_overcrowding(
            database_url,
            {
                "country.portugal": "5",
                "country.spain": "6",
                "country.greece": "20",
                "country.italy": "25",
                "country.france": "25",
            },
        )
        threshold = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/country.overcrowding_rate",
            json={"matching_threshold": {"max_value": 15}},
        )
        assert threshold.status_code == 200
        kept = await api.post(
            "/v1/evaluations", json={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        )
        assert kept.status_code == 201

        live = (
            await api.get(
                "/v1/rankings", params={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
            )
        ).json()["candidates"]
        saved = (await api.get(f"/v1/evaluations/{kept.json()['id']}")).json()["candidates"]

        order = [(c["candidate"], c["score"]) for c in live]
        assert order == [(c["candidate"], c["score"]) for c in saved]
        unranked = [c for c in live if c["rank"] is None]
        assert [c["candidate"] for c in unranked[:3]] == [
            "country.greece",
            "country.france",
            "country.italy",
        ]
        scored = [c["score"] for c in unranked if c["score"] is not None]
        assert scored == sorted(scored, reverse=True)
        assert unranked[0]["score"] > unranked[1]["score"] == unranked[2]["score"]
        unscored = [c["candidate"] for c in unranked if c["score"] is None]
        assert unscored == sorted(unscored)
        assert all(c["score"] is None for c in unranked[len(scored) :])


async def _store_overcrowding(database_url: str, figures: dict[str, str]) -> None:
    """Every minimal attribute for each candidate, varying only overcrowding, scale 100."""
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from psycopg_pool import AsyncConnectionPool

    from starnest.data import ConfidenceLevel, Quantity, Ratio, ReferencePeriod, Value, ValueType
    from starnest.storage import PostgresValueStore

    last_year = date.today().year - 1
    period = ReferencePeriod(start=date(last_year, 1, 1), end=date(last_year, 12, 31))

    def a_figure(candidate: str, attribute: str, figure: str) -> Value:
        satisfaction = attribute == "country.life_satisfaction"
        return Value(
            candidate=candidate,
            attribute=attribute,
            value_type=ValueType.QUANTITY if satisfaction else ValueType.RATIO,
            data_source="eurostat",
            reference_period=period,
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=(
                Quantity(magnitude=Decimal(figure), unit="ladder_points")
                if satisfaction
                else Ratio(value=Decimal(figure), basis="households")
            ),
        )

    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, 100)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = 100"
            )
        await PostgresValueStore(pool).append(
            [
                figure
                for candidate, overcrowding in figures.items()
                for figure in (
                    a_figure(candidate, "country.overcrowding_rate", overcrowding),
                    a_figure(candidate, "country.housing_cost_overburden_rate", "10"),
                    a_figure(candidate, "country.life_satisfaction", "7"),
                )
            ]
        )


GREECE = "country.greece"
OVERCROWDING = "country.overcrowding_rate"
A_GATE = "not_manually_excluded"


async def _greece_refused_twice(api: httpx.AsyncClient, criteria_set: str) -> None:
    """Greece ruled out by a gate somebody answered and by a threshold its figure crosses:
    the two refusals whose evidence a saved ranking has to keep (FU-A3, FU-A4)."""
    enforced = await api.put(
        f"/v1/criteria-sets/{criteria_set}/match-rules/{A_GATE}", json={"is_enforced": True}
    )
    answered = await api.put(
        f"/v1/match-rule-results/{A_GATE}/{GREECE}",
        json={
            "match_result": "not_matching",
            "reason": "Ruled out by hand",
            "citations": ["https://example.org/why"],
        },
    )
    threshold = await api.patch(
        f"/v1/criteria-sets/{criteria_set}/criteria/{OVERCROWDING}",
        json={"matching_threshold": {"max_value": 20}},
    )
    assert [enforced.status_code, answered.status_code, threshold.status_code] == [204, 200, 200]


async def _keep(api: httpx.AsyncClient, criteria_set: str) -> int:
    kept = await api.post("/v1/evaluations", json={"criteria_set": criteria_set, "level": COUNTRY})
    assert kept.status_code == 201
    return kept.json()["id"]


class TestASavedRankingShowsItsEvidence:
    """D46: a saved ranking serves what each number was read from, frozen with it (PL-144).

    Every figure on screen carries its source and both dates; a refusal names the gate answer
    or the figure it judged, a warning its inputs; and the pillars and the difference from home
    are derived from the saved contributions, so the reopened ranking reads as the live one did.
    """

    async def test_the_saved_ranking_reads_as_the_live_one_did(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        await _greece_refused_twice(api, a_scratch_criteria_set)
        home = await api.put(
            "/v1/household", json={**A_HOUSEHOLD, "home_country_candidate": PORTUGAL}
        )
        assert home.status_code == 200
        params = {"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        live = (await api.get("/v1/rankings", params=params)).json()

        saved = (
            await api.get(f"/v1/evaluations/{await _keep(api, a_scratch_criteria_set)}")
        ).json()

        assert saved["candidates"] == live["candidates"]
        greece = next(c for c in saved["candidates"] if c["candidate"] == GREECE)
        assert greece["pillar_scores"], "pillars derive from the saved contributions"
        assert greece["delta_vs_home"] is not None

    async def test_the_drill_downs_agree_on_the_evidence_too(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        """`live == saved` over a candidate with both kinds of refusal, so the comparison
        reaches the evidence and its provenance rather than empty lists."""
        await _greece_refused_twice(api, a_scratch_criteria_set)
        params = {"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        live = (await api.get(f"/v1/rankings/candidates/{GREECE}", params=params)).json()

        evaluation = await _keep(api, a_scratch_criteria_set)
        saved = (await api.get(f"/v1/evaluations/{evaluation}/candidates/{GREECE}")).json()

        assert len(saved["non_match_reasons"]) == 2
        assert live == saved

    async def test_a_gate_held_as_a_warning_is_saved_as_a_warning(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        """D56 (PL-157): a gate the set holds as a warning keeps Greece matching with a warning
        that names the gate and the answer it read, and the saved ranking keeps meaning that --
        `live == saved` over the whole drill-down, and the frozen set holds the outcome too."""
        softened = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/{A_GATE}",
            json={"is_enforced": True, "outcome": "warning"},
        )
        answered = await api.put(
            f"/v1/match-rule-results/{A_GATE}/{GREECE}",
            json={
                "match_result": "not_matching",
                "reason": "Ruled out by hand",
                "citations": ["https://example.org/why"],
            },
        )
        assert [softened.status_code, answered.status_code] == [204, 200]
        params = {"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        live = (await api.get(f"/v1/rankings/candidates/{GREECE}", params=params)).json()
        live_ranking = (await api.get("/v1/rankings", params=params)).json()

        evaluation = await _keep(api, a_scratch_criteria_set)
        saved = (await api.get(f"/v1/evaluations/{evaluation}/candidates/{GREECE}")).json()
        saved_ranking = (await api.get(f"/v1/evaluations/{evaluation}")).json()
        await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/{A_GATE}",
            json={"is_enforced": True, "outcome": "not_matching"},
        )
        reopened = (await api.get(f"/v1/evaluations/{evaluation}/candidates/{GREECE}")).json()

        assert saved["match_status"] == "matching"
        assert saved["non_match_reasons"] == []
        [warning] = saved["warnings"]
        assert (warning["match_rule"], warning["compound_rule"], warning["detail"]) == (
            A_GATE,
            None,
            "Ruled out by hand",
        )
        assert warning["gate_answer"]["citations"] == ["https://example.org/why"]
        assert live == saved
        assert saved_ranking["candidates"] == live_ranking["candidates"]
        assert reopened == saved, "hardening the live set leaves the saved ranking as it was"

    async def test_each_contribution_names_the_value_it_used_with_its_provenance(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        detail = (await api.get(f"/v1/evaluations/{kept['id']}/candidates/{PORTUGAL}")).json()

        by_attribute = {row["attribute"]: row for row in detail["attribute_scores"]}
        used = by_attribute[OVERCROWDING]["value"]
        assert (used["candidate"], used["attribute"], used["payload"]["value"]) == (
            PORTUGAL,
            OVERCROWDING,
            9,
        )
        assert used["data_source"] == "eurostat"
        assert used["reference_period"] == {"start": "2025-01-01", "end": "2025-12-31"}
        assert used["retrieval_date"]
        missing = [row for row in detail["attribute_scores"] if row["normalised_score"] is None]
        assert missing, "the minimal set has a criterion stored_figures does not answer"
        assert all(row["value"] is None for row in missing)

    async def test_a_refusal_names_the_gate_answer_or_the_figure_it_judged(
        self, api: httpx.AsyncClient, stored_figures: None, a_scratch_criteria_set: str
    ) -> None:
        await _greece_refused_twice(api, a_scratch_criteria_set)
        evaluation = await _keep(api, a_scratch_criteria_set)
        # The answer changes after the save; the saved refusal keeps the one it read.
        await api.put(
            f"/v1/match-rule-results/{A_GATE}/{GREECE}",
            json={"match_result": "not_matching", "reason": "A later answer"},
        )

        saved = (await api.get(f"/v1/evaluations/{evaluation}")).json()

        greece = next(c for c in saved["candidates"] if c["candidate"] == GREECE)
        by_kind = {
            ("gate" if reason["match_rule"] else "threshold"): reason
            for reason in greece["non_match_reasons"]
        }
        gate, threshold = by_kind["gate"], by_kind["threshold"]
        assert gate["gate_answer"]["reason"] == "Ruled out by hand"
        assert gate["gate_answer"]["citations"] == ["https://example.org/why"]
        assert gate["inputs"] == []
        (judged,) = threshold["inputs"]
        assert (judged["attribute"], judged["payload"]["value"]) == (OVERCROWDING, 27)
        assert judged["data_source"] == "eurostat"
        assert threshold["gate_answer"] is None

    async def test_a_ranking_saved_before_its_evidence_was_kept_still_opens(
        self,
        api: httpx.AsyncClient,
        stored_figures: None,
        a_scratch_criteria_set: str,
        database_url: str,
    ) -> None:
        """Rankings saved before `0510` hold no refusal evidence. They open, with none."""
        await _greece_refused_twice(api, a_scratch_criteria_set)
        evaluation = await _keep(api, a_scratch_criteria_set)
        async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as db:
            await db.execute(
                "UPDATE non_match_reason SET match_rule_answer = NULL, used_value = NULL"
            )

        ranking = await api.get(f"/v1/evaluations/{evaluation}")
        detail = await api.get(f"/v1/evaluations/{evaluation}/candidates/{GREECE}")

        assert [ranking.status_code, detail.status_code] == [200, 200]
        reasons = detail.json()["non_match_reasons"]
        assert len(reasons) == 2
        assert all(r["gate_answer"] is None and r["inputs"] == [] for r in reasons)


class TestALeaderAndADiscard:
    """PL-145: a saved ranking names its leader, and can be discarded (D47)."""

    async def test_the_summary_names_who_led(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        (listed,) = (await api.get("/v1/evaluations")).json()["items"]

        assert kept["leader"] == {"candidate": PORTUGAL, "name": "Portugal"}
        assert listed["leader"] == kept["leader"]

    async def test_a_ranking_with_nobody_ranked_has_no_leader(self, api: httpx.AsyncClient) -> None:
        put = await api.put("/v1/settings", json={"score_scale_max": 100})
        assert put.status_code == 200

        kept = await _keep_one(api)

        assert kept["leader"] is None

    async def test_a_discarded_ranking_is_gone_from_every_read(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        discarded = await api.delete(f"/v1/evaluations/{kept['id']}")

        assert discarded.status_code == 204
        for path in ("", "/criteria", f"/candidates/{PORTUGAL}"):
            assert (await api.get(f"/v1/evaluations/{kept['id']}{path}")).status_code == 404
        assert (await api.get("/v1/evaluations")).json()["items"] == []

    async def test_discarding_one_nobody_kept_is_a_404_naming_it(
        self, api: httpx.AsyncClient
    ) -> None:
        refused = await api.delete("/v1/evaluations/999999")

        assert refused.status_code == 404
        assert refused.json()["code"] == "not_found"
        assert refused.json()["details"] == {"evaluation": 999999}

    async def test_two_discards_at_once_discard_it_once(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        kept = await _keep_one(api)

        both = await asyncio.gather(
            api.delete(f"/v1/evaluations/{kept['id']}"),
            api.delete(f"/v1/evaluations/{kept['id']}"),
        )

        assert sorted(response.status_code for response in both) == [204, 404]
