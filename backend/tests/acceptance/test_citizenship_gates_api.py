"""The household's citizenships drive the gates that name them (`reqs.md` 3.7, 7.3, Q239).

Which citizenship clears which gate is catalog data (`0517`), so these tests read the catalog
rather than restating it: every gate that names clearing citizenships is evaluated against the
household, a clearing citizenship clears it with or without a recorded answer, one that clears
nothing leaves the recorded answer -- or, for EU free movement, the derivation -- to rule out.
"""

import httpx
import psycopg

from .conftest import A_HOUSEHOLD

COUNTRY = "country"
UNITED_KINGDOM = "country.united_kingdom"
PORTUGAL = "country.portugal"
UK_ROUTE = "uk_skilled_worker"
FREE_MOVEMENT = "eu_free_movement"


async def _hold(api: httpx.AsyncClient, *citizenships: str) -> None:
    response = await api.put("/v1/household", json=A_HOUSEHOLD | {"citizenships": citizenships})
    assert response.status_code == 200


async def _enforce(api: httpx.AsyncClient, criteria_set: str, gate: str, **body: object) -> None:
    response = await api.put(
        f"/v1/criteria-sets/{criteria_set}/match-rules/{gate}",
        json={"is_enforced": True} | body,
    )
    assert response.status_code == 204


async def _refuse(api: httpx.AsyncClient, gate: str, candidate: str) -> None:
    response = await api.put(
        f"/v1/match-rule-results/{gate}/{candidate}",
        json={"match_result": "not_matching", "reason": "No route found"},
    )
    assert response.status_code == 200


async def _ranked(api: httpx.AsyncClient, criteria_set: str) -> dict[str, dict]:
    response = await api.get(
        "/v1/rankings", params={"criteria_set": criteria_set, "level": COUNTRY}
    )
    assert response.status_code == 200
    return {row["candidate"]: row for row in response.json()["candidates"]}


def _gates_refusing(row: dict) -> set[str]:
    return {reason["match_rule"] for reason in row["non_match_reasons"] if reason["match_rule"]}


def _concerned(database_url: str, gate: str) -> list[str]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT candidate FROM match_rule_candidate WHERE match_rule = %s ORDER BY 1", (gate,)
        ).fetchall()
    return [row[0] for row in rows]


class TestABritishCitizenshipBringsTheUnitedKingdomBack:
    async def test_the_uk_route_answered_not_matching_is_cleared_by_a_british_citizenship(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, "country.romania")
        await _enforce(api, a_scratch_criteria_set, UK_ROUTE)
        await _refuse(api, UK_ROUTE, UNITED_KINGDOM)
        before = (await _ranked(api, a_scratch_criteria_set))[UNITED_KINGDOM]

        await _hold(api, "country.romania", UNITED_KINGDOM)

        after = (await _ranked(api, a_scratch_criteria_set))[UNITED_KINGDOM]
        assert (before["match_status"], _gates_refusing(before)) == ("not_matching", {UK_ROUTE})
        assert after["match_status"] != "not_matching"
        assert _gates_refusing(after) == set()

    async def test_the_answer_that_assumed_the_old_citizenships_is_flagged_and_kept(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, "country.romania")
        await _refuse(api, UK_ROUTE, UNITED_KINGDOM)

        await _hold(api, UNITED_KINGDOM)

        listed = await api.get(
            "/v1/match-rule-results", params={"match_rule": UK_ROUTE, "candidate": UNITED_KINGDOM}
        )
        (answer,) = listed.json()["items"]
        assert answer["assumed_citizenships"] == ["country.romania"]
        assert answer["needs_recheck"] is True
        assert (answer["match_result"], answer["reason"]) == ("not_matching", "No route found")


class TestEuFreeMovementIsDerived:
    async def test_it_rules_out_with_no_recorded_answer_where_no_citizenship_clears_it(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, UNITED_KINGDOM)
        await _enforce(api, a_scratch_criteria_set, FREE_MOVEMENT)

        ranked = await _ranked(api, a_scratch_criteria_set)

        (reason,) = ranked[PORTUGAL]["non_match_reasons"]
        assert (reason["match_rule"], reason["gate_answer"]) == (FREE_MOVEMENT, None)
        assert reason["citizenships"] == [UNITED_KINGDOM]
        assert _gates_refusing(ranked[UNITED_KINGDOM]) == set()

    async def test_an_eu_citizenship_clears_it_with_no_recorded_answer(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, "country.romania")
        await _enforce(api, a_scratch_criteria_set, FREE_MOVEMENT)

        ranked = await _ranked(api, a_scratch_criteria_set)

        assert all(FREE_MOVEMENT not in _gates_refusing(row) for row in ranked.values())

    async def test_held_as_a_warning_it_flags_and_leaves_the_candidate_matching(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, UNITED_KINGDOM)
        await _enforce(api, a_scratch_criteria_set, FREE_MOVEMENT, outcome="warning")

        portugal = (await _ranked(api, a_scratch_criteria_set))[PORTUGAL]

        assert portugal["match_status"] == "matching"
        (warning,) = [flag for flag in portugal["warnings"] if flag["match_rule"]]
        assert (warning["match_rule"], warning["citizenships"]) == (
            FREE_MOVEMENT,
            [UNITED_KINGDOM],
        )

    async def test_with_no_household_recorded_nothing_is_derived(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _enforce(api, a_scratch_criteria_set, FREE_MOVEMENT)

        ranked = await _ranked(api, a_scratch_criteria_set)

        assert all(_gates_refusing(row) == set() for row in ranked.values())

    async def test_a_saved_ranking_keeps_the_citizenships_its_refusal_read(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, stored_figures: None
    ) -> None:
        await _hold(api, UNITED_KINGDOM)
        await _enforce(api, a_scratch_criteria_set, FREE_MOVEMENT)
        kept = await api.post(
            "/v1/evaluations", json={"criteria_set": a_scratch_criteria_set, "level": COUNTRY}
        )
        assert kept.status_code == 201
        live = (
            await api.get(
                f"/v1/rankings/candidates/{PORTUGAL}",
                params={"criteria_set": a_scratch_criteria_set, "level": COUNTRY},
            )
        ).json()

        await _hold(api, "country.romania")

        saved = (await api.get(f"/v1/evaluations/{kept.json()['id']}/candidates/{PORTUGAL}")).json()
        assert saved["non_match_reasons"] == live["non_match_reasons"]
        assert saved["non_match_reasons"][0]["citizenships"] == [UNITED_KINGDOM]


class TestEveryGateNamingCitizenshipsIsEvaluatedAgainstTheHousehold:
    """The structural guard: over the catalog as shipped, not over a list written here."""

    async def test_each_clearing_citizenship_clears_its_gate_and_another_does_not(
        self,
        api: httpx.AsyncClient,
        a_scratch_criteria_set: str,
        stored_figures: None,
        database_url: str,
    ) -> None:
        gates = (await api.get("/v1/match-rules", params={"level": COUNTRY})).json()["items"]
        named = [gate for gate in gates if gate["cleared_by"]]
        clearing = {held for gate in named for held in gate["cleared_by"]}
        roster = (await api.get("/v1/candidates", params={"level": COUNTRY})).json()["items"]
        (clears_nothing, *_) = sorted(
            {row["id"] for row in roster} - clearing - {UNITED_KINGDOM, "country.switzerland"}
        )
        assert {UK_ROUTE, FREE_MOVEMENT, "ch_eu_efta_quota"} <= {gate["id"] for gate in named}

        for gate in named:
            await _enforce(api, a_scratch_criteria_set, gate["id"])
            concerned = _concerned(database_url, gate["id"])
            if not gate["decided_by_citizenship"]:
                for candidate in concerned:
                    await _refuse(api, gate["id"], candidate)
            for held in gate["cleared_by"]:
                await _hold(api, held)
                ranked = await _ranked(api, a_scratch_criteria_set)
                assert [c for c in concerned if gate["id"] in _gates_refusing(ranked[c])] == [], (
                    f"{held} should clear {gate['id']}"
                )
            await _hold(api, clears_nothing)
            ranked = await _ranked(api, a_scratch_criteria_set)
            assert all(gate["id"] in _gates_refusing(ranked[c]) for c in concerned), (
                f"{clears_nothing} should not clear {gate['id']}"
            )
