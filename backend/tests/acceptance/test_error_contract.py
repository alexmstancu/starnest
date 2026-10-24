"""How this API says no, in every way it has to say it.

`arch.md` 7.6: one error shape everywhere -- a stable machine-readable `code`, a human-readable
`message`, optional `details`. **Clients branch on `code`, never on prose**, so the code is part
of the contract and the message is not.

That makes the failure paths worth more testing than the success ones, not less. A client that
cannot tell "no such criteria set" from "the database is down" will do the wrong thing on both,
and the difference is invisible until it happens to somebody.
"""

import json
from collections.abc import AsyncIterator

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from .contract import response_schema, undeclared_fields, validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MINIMAL = "minimal"
OVERBURDEN = "country.housing_cost_overburden_rate"
A_RANKING = {"criteria_set": MINIMAL, "level": COUNTRY}

A_VALID_HOUSEHOLD = {
    "net_income": 5000,
    "number_adults": 2,
    "number_children": 0,
    "home_country_candidate": "country.romania",
    "citizenships": ["country.romania"],
}


class TestTheOneErrorShape:
    async def test_a_domain_refusal_carries_a_code_and_a_message(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get("/v1/criteria-sets/nobody_made_this")).json()

        assert set(body) >= {"code", "message"}
        assert body["code"] == "not_found"
        assert body["message"]

    async def test_the_code_is_stable_and_the_message_is_not_the_thing_to_branch_on(
        self, api: httpx.AsyncClient
    ) -> None:
        """Two different missing sets, one code, two messages naming what was missing."""
        first = (await api.get("/v1/criteria-sets/one_missing_set")).json()
        second = (await api.get("/v1/criteria-sets/another_missing_set")).json()

        assert first["code"] == second["code"] == "not_found"
        assert first["message"] != second["message"]

    async def test_details_name_the_offending_thing_where_there_is_one(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A message a user cannot act on is barely better than no message.

        The locked weights are what the Configure screen lists under "Locked, so unable to
        absorb the change", so they travel in `details` rather than only in the prose.
        """
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/country.overcrowding_rate",
            json={"weight_locked": True},
        )
        # Only two criteria in that pillar, and the other is now locked, so nothing can absorb.
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 70},
        )

        if response.status_code == 409:
            body = response.json()
            assert body["code"] == "weights_all_locked"
            assert body.get("details", {}).get("locked")


class TestWhatIsNotThere:
    async def test_an_unknown_path_is_a_404(self, api: httpx.AsyncClient) -> None:
        assert (await api.get("/v1/nothing-here")).status_code == 404

    async def test_an_unversioned_path_is_not_served(self, api: httpx.AsyncClient) -> None:
        """Versioned from the first request (`arch.md` 7.6). A client that dropped the prefix
        must fail rather than be quietly accommodated, or the version stops meaning anything."""
        assert (await api.get("/settings")).status_code == 404

    async def test_a_method_the_route_does_not_have_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """`GET /rankings` exists; `DELETE` does not, and 405 says which of the two is wrong."""
        assert (await api.delete("/v1/rankings")).status_code == 405

    async def test_a_criteria_set_that_does_not_exist_is_a_404_on_every_route_that_names_one(
        self, api: httpx.AsyncClient
    ) -> None:
        missing = "no_such_set"

        read = await api.get(f"/v1/criteria-sets/{missing}")
        ranking = await api.get("/v1/rankings", params={"criteria_set": missing, "level": COUNTRY})
        patch = await api.patch(
            f"/v1/criteria-sets/{missing}/criteria/{OVERBURDEN}", json={"weight": 50}
        )

        assert [read.status_code, ranking.status_code, patch.status_code] == [404, 404, 404]
        assert {read.json()["code"], ranking.json()["code"], patch.json()["code"]} == {"not_found"}


class TestRequestsThatDoNotMakeSense:
    async def test_a_required_query_parameter_missing_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        """`criteria_set` and `level` are both required by the design. A ranking of "whatever
        you assume I meant" is the wrong kind of helpful."""
        response = await api.get("/v1/rankings")

        assert response.status_code == 422
        _assert_in_the_one_error_shape("getRanking", response.json())

    async def test_a_weight_outside_the_percentage_range_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 140},
        )

        assert response.status_code == 422
        _assert_in_the_one_error_shape("updateCriterion", response.json())

    async def test_a_weight_that_is_not_a_number_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": "heavy"},
        )

        assert response.status_code == 422
        _assert_in_the_one_error_shape("updateCriterion", response.json())

    async def test_an_unknown_field_in_the_body_is_not_silently_swallowed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A misspelled field ignored is a preference the user expressed and the application
        discarded. Refused, as every undeclared field now is (BE-23), and nothing changed."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"wieght": 70},
        )

        _assert_refused_naming("updateCriterion", response, ["body", "wieght"])
        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert float(overburden["weight"]) == 50

    async def test_a_level_nothing_is_ranked_at_is_refused_rather_than_answered_emptily(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """An empty ranking and "this set scores nothing at that level" look identical to a
        client, and only one of them is true."""
        await _set_the_score_scale(database_url, 100)

        response = await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": "city"})

        assert response.status_code == 422
        assert response.json()["code"] == "cannot_be_ranked"
        _assert_in_the_one_error_shape("getRanking", response.json())


class TestARefusalTheStopRuleRequires:
    async def test_an_unset_score_scale_refuses_rather_than_assuming_one_hundred(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`devplan.md` 0.3 applied to a number.

        `score_scale_max` is nullable and unseeded by design. Substituting 100 would produce a
        whole ranking on a scale nobody chose, and every figure in it would look right.
        """
        await _set_the_score_scale(database_url, None)

        response = await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})

        assert response.status_code == 409
        # **The code, not a substring of the body.** `"score_scale_max" in response.text` is
        # true of `{"detail": {...}}` too -- FastAPI's own validation shape -- so this passed
        # for either of the two error shapes P14 exists to keep apart, which is the one thing
        # it was written to distinguish.
        assert response.json()["code"] == "score_scale_not_set"
        assert "score_scale_max" in response.json()["message"]

    @pytest.mark.parametrize(
        ("operation", "method", "path", "sent"),
        [
            ("getRanking", "GET", "/v1/rankings", {"params": A_RANKING}),
            (
                "getRankedCandidateDetail",
                "GET",
                "/v1/rankings/candidates/country.portugal",
                {"params": A_RANKING},
            ),
            ("saveEvaluation", "POST", "/v1/evaluations", {"json": A_RANKING}),
        ],
    )
    async def test_every_operation_that_scores_declares_the_refusal(
        self,
        api: httpx.AsyncClient,
        database_url: str,
        operation: str,
        method: str,
        path: str,
        sent: dict,
    ) -> None:
        """All three score, so all three answer it -- and the design declared it for none, so
        `validate` read the 409 as nothing to check (PL-003)."""
        await _set_the_score_scale(database_url, None)

        response = await api.request(method, path, **sent)

        assert response.status_code == 409
        assert response_schema(operation, 409) == {"$ref": "#/components/schemas/Error"}
        validate(operation, response.json(), status=409)
        assert response.json()["code"] == "score_scale_not_set"


class TestBoundaryValidationAndTheErrorShape:
    """Bad input is refused at the boundary, in the one error shape -- never 500'd in domain
    construction and never silently coerced (BE-21, BE-22, BE-23).

    The request body carries the domain's own bounds, so an out-of-range or empty value is a 422
    FastAPI raises before the endpoint runs -- and that 422 is rendered as `code`/`message` like
    every other refusal, not FastAPI's own `{detail: [...]}`, a shape no client was told about.
    """

    async def test_a_malformed_request_uses_the_one_error_shape(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.get("/v1/rankings")  # both required query params missing

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "invalid_request"
        assert body["message"]
        assert "detail" not in body
        _assert_in_the_one_error_shape("getRanking", body)

    async def test_renaming_a_set_to_an_empty_name_is_refused_not_500(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """`rename_criteria_set` uses `model_copy`, which skips validation, so an empty name once
        persisted and then no read could reconstruct the set (`CriteriaSet.name` has min_length 1)
        -- a 500 on the next GET. The bound belongs on the request body, where it is a 422 and
        nothing is written."""
        response = await api.patch(f"/v1/criteria-sets/{a_scratch_criteria_set}", json={"name": ""})

        assert response.status_code == 422
        _assert_in_the_one_error_shape("renameCriteriaSet", response.json())
        reread = await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")
        assert reread.status_code == 200
        assert reread.json()["name"] == "Scratch", "nothing was written"

    async def test_duplicating_a_set_to_an_empty_name_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/criteria-sets/minimal/duplicate", json={"id": "dup_blank_name", "name": ""}
        )

        assert response.status_code == 422
        _assert_in_the_one_error_shape("duplicateCriteriaSet", response.json())
        assert (await api.get("/v1/criteria-sets/dup_blank_name")).status_code == 404

    async def test_creating_a_set_with_a_blank_id_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.post("/v1/criteria-sets", json={"id": "", "name": "Nameless"})

        assert response.status_code == 422
        _assert_in_the_one_error_shape("createCriteriaSet", response.json())

    async def test_a_zero_score_scale_is_refused_not_500(self, api: httpx.AsyncClient) -> None:
        """`Settings` requires `score_scale_max > 0`; `SettingsBody` carried no bound, so the
        domain `ValidationError` escaped to a 500. The bound belongs on the body."""
        response = await api.put("/v1/settings", json={"score_scale_max": 0})

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_request"
        _assert_in_the_one_error_shape("replaceSettings", response.json())

    async def test_a_coverage_over_one_hundred_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put("/v1/settings", json={"min_coverage": 150})

        assert response.status_code == 422
        _assert_in_the_one_error_shape("replaceSettings", response.json())

    async def test_a_negative_spend_cap_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put("/v1/settings", json={"run_spend_cap_eur": -5})

        assert response.status_code == 422
        _assert_in_the_one_error_shape("replaceSettings", response.json())

    async def test_a_non_finite_spend_cap_is_refused(self, api: httpx.AsyncClient) -> None:
        """A NaN/Infinity cap would make the meter never trip; the float field forbids it."""
        import json as _json

        response = await api.put(
            "/v1/settings",
            content=_json.dumps({"run_spend_cap_eur": float("inf")}),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 422
        _assert_in_the_one_error_shape("replaceSettings", response.json())

    async def test_an_unknown_setting_field_is_refused_not_silently_dropped(
        self, api: httpx.AsyncClient
    ) -> None:
        """A misspelled field in a whole-replace PUT would fall to its null default and clear the
        real setting (BE-23). `extra='forbid'` refuses it instead of accepting and dropping it."""
        response = await api.put("/v1/settings", json={"score_scale_max": 100, "coverage_min": 60})

        _assert_refused_naming("replaceSettings", response, ["body", "coverage_min"])

    async def test_a_negative_income_is_refused_not_500(self, api: httpx.AsyncClient) -> None:
        """`Household` requires `net_income >= 0`; `HouseholdBody` carried no bound, so a negative
        income escaped into a 500 at domain construction. The bound belongs on the body."""
        response = await api.put("/v1/household", json={**A_VALID_HOUSEHOLD, "net_income": -100})

        assert response.status_code == 422
        _assert_in_the_one_error_shape("replaceHousehold", response.json())

    async def test_an_unknown_household_field_is_refused(self, api: httpx.AsyncClient) -> None:
        """A misspelled field in this whole-replace PUT would fall to its default and quietly
        change the stored household (BE-23)."""
        response = await api.put("/v1/household", json={**A_VALID_HOUSEHOLD, "incme": 9000})

        _assert_refused_naming("replaceHousehold", response, ["body", "incme"])


class TestAFieldNobodyDeclaredIsRefused:
    """BE-23. Pydantic drops a field a body does not declare unless told otherwise, and the
    bodies never told answered as though the field had not been sent. For a run's scope that is
    the harmful case: a misspelled `candidates` fell to null, which means the whole level."""

    async def test_a_misspelled_scope_field_is_refused_rather_than_planning_every_candidate(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={"level": COUNTRY, "candidate": ["country.portugal"]},
        )

        _assert_refused_naming("planRun", response, ["body", "candidate"])

    async def test_a_misspelled_scope_field_is_refused_rather_than_running_every_candidate(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs", json={"level": COUNTRY, "candidate": ["country.portugal"]}
        )

        _assert_refused_naming("startRun", response, ["body", "candidate"])
        assert await _runs_recorded(api) == 0, "nothing ran"

    async def test_a_misspelled_retry_field_is_refused_and_no_run_is_started(
        self, api: httpx.AsyncClient
    ) -> None:
        """The stub source declines Portugal, so the run has failures a retry would reach."""
        earlier = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        response = await api.post(
            f"/v1/data-acquisition-runs/{earlier['id']}/retry", json={"itmes": "unanswered"}
        )

        _assert_refused_naming("retryRun", response, ["body", "itmes"])
        assert await _runs_recorded(api) == 1, "no second run"

    async def test_a_misspelled_gate_answer_field_is_refused_and_nothing_is_recorded(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _gate_answers_recorded(api)

        response = await api.put(
            A_GATE_ANSWER_PATH, json={"match_result": "not_matching", "reasn": "no route"}
        )

        _assert_refused_naming("putMatchRuleResult", response, ["body", "reasn"])
        assert await _gate_answers_recorded(api) == before, "nothing was recorded"

    async def test_an_unknown_field_inside_a_gate_answer_s_period_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _gate_answers_recorded(api)

        response = await api.put(
            A_GATE_ANSWER_PATH,
            json={
                "match_result": "matching",
                "reference_period": {"start": "2026-01-01", "end": "2026-12-31", "ends": "2027"},
            },
        )

        _assert_refused_naming("putMatchRuleResult", response, ["body", "reference_period", "ends"])
        assert await _gate_answers_recorded(api) == before, "nothing was recorded"

    async def test_a_misspelled_manual_value_field_is_refused_and_nothing_is_stored(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _values_stored(api)

        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"qoute": "from the official gazette"}
        )

        _assert_refused_naming("enterValueManually", response, ["body", "qoute"])
        assert await _values_stored(api) == before, "nothing was stored"

    async def test_an_unknown_field_inside_a_manual_value_s_period_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _values_stored(api)

        response = await api.post(
            "/v1/values/manual",
            json=A_TYPED_VALUE
            | {"reference_period": {"start": "2026-01-01", "end": "2026-12-31", "ends": "2027"}},
        )

        _assert_refused_naming("enterValueManually", response, ["body", "reference_period", "ends"])
        assert await _values_stored(api) == before, "nothing was stored"

    async def test_a_misspelled_evaluation_field_is_refused_and_nothing_is_kept(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        await _set_the_score_scale(database_url, 100)

        response = await api.post(
            "/v1/evaluations",
            json={"criteria_set": MINIMAL, "level": COUNTRY, "notes": "the one to compare"},
        )

        _assert_refused_naming("saveEvaluation", response, ["body", "notes"])
        assert (await api.get("/v1/evaluations")).json()["items"] == [], "nothing was kept"

    async def test_an_unknown_field_inside_a_scale_anchor_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "normalisation_method": "fixed",
                "scale_anchors": [_AN_ANCHOR | {"lable": "comfortable"}, _ANOTHER_ANCHOR],
            },
        )

        _assert_refused_naming("updateCriterion", response, ["body", "scale_anchors", "0", "lable"])
        assert await _the_anchors_on_overburden(api, a_scratch_criteria_set) == []

    @pytest.mark.parametrize(
        ("operation", "rule", "body", "listed_in"),
        [
            (
                "setMatchRuleEnforcement",
                "match-rules/eu_free_movement",
                {"is_enforced": True},
                "enforced_match_rules",
            ),
            (
                "setCompoundRuleApplication",
                "compound-rules/cheap_but_taxed",
                {"is_applied": True},
                "applied_compound_rules",
            ),
        ],
        ids=["a gate", "a compound rule"],
    )
    async def test_an_unknown_field_beside_a_rule_switch_is_refused_and_nothing_changes(
        self,
        api: httpx.AsyncClient,
        a_scratch_criteria_set: str,
        operation: str,
        rule: str,
        body: dict,
        listed_in: str,
    ) -> None:
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/{rule}",
            json=body | {"because": "the household said so"},
        )

        _assert_refused_naming(operation, response, ["body", "because"])
        reread = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        assert rule.rsplit("/", 1)[-1] not in reread[listed_in], "nothing changed"


class TestANullTheDesignGivesNoMeaning:
    """BE-23. **Left out means "no change"; null is a value, and only where the design gives
    it one** -- a band's bound or a threshold, where null clears. Elsewhere a null was coerced
    into something nobody sent (`scale_anchors: null` cleared the anchors, `required_value:
    null` became `false`) or taken as though the field were absent."""

    async def test_null_scale_anchors_are_refused_rather_than_clearing_them(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}"
        await api.patch(
            path,
            json={"normalisation_method": "fixed", "scale_anchors": [_AN_ANCHOR, _ANOTHER_ANCHOR]},
        )

        response = await api.patch(path, json={"scale_anchors": None})

        _assert_refused_naming("updateCriterion", response, ["body", "scale_anchors"])
        assert len(await _the_anchors_on_overburden(api, a_scratch_criteria_set)) == 2

    async def test_an_empty_list_of_anchors_still_clears_them(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The control: clearing the anchors is a request the design can express."""
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}"
        await api.patch(
            path,
            json={"normalisation_method": "fixed", "scale_anchors": [_AN_ANCHOR, _ANOTHER_ANCHOR]},
        )

        response = await api.patch(path, json={"scale_anchors": []})

        assert response.status_code == 200
        assert await _the_anchors_on_overburden(api, a_scratch_criteria_set) == []

    async def test_a_null_required_value_is_refused_as_a_null(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """It was coerced to `false`, and then refused -- if at all -- for its shape."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {"required_value": None}},
        )

        _assert_refused_naming(
            "updateCriterion", response, ["body", "matching_threshold", "required_value"]
        )
        assert await _the_threshold_on_overburden(api, a_scratch_criteria_set) is None

    async def test_a_null_threshold_still_clears_it(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The control: the design documents `matching_threshold: null` as "Null clears it"."""
        path = f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}"
        await api.patch(path, json={"matching_threshold": {"min_value": None, "max_value": 30}})

        response = await api.patch(path, json={"matching_threshold": None})

        assert response.status_code == 200
        assert await _the_threshold_on_overburden(api, a_scratch_criteria_set) is None

    async def test_a_null_is_scored_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"is_scored": None},
        )

        _assert_refused_naming("updateCriterion", response, ["body", "is_scored"])

    async def test_a_null_pillar_weight_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.put(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/pillar-weights/housing",
            json={"weight": None},
        )

        _assert_refused_naming("updatePillarWeight", response, ["body", "weight"])

    async def test_a_null_source_switch_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.patch("/v1/data-sources/eurostat", json={"is_enabled": None})

        _assert_refused_naming("updateDataSource", response, ["body", "is_enabled"])


class TestAQueryParameterNobodyDeclared:
    """BE-23. FastAPI ignores a query parameter no route declares, so a misspelled one answered
    as though it had not been sent and a filter the server does not apply returned everything
    unfiltered."""

    async def test_an_unknown_query_parameter_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        await _set_the_score_scale(database_url, 100)

        response = await api.get(
            "/v1/rankings",
            params={"criteria_set": MINIMAL, "level": COUNTRY, "criteria_sett": "remote_only"},
        )

        _assert_refused_naming("getRanking", response, ["query", "criteria_sett"])

    async def test_one_that_would_have_started_a_run_is_refused_and_nothing_runs(
        self, api: httpx.AsyncClient
    ) -> None:
        """`dry_run=true` read as a dry run by whoever sent it, and started a real one."""
        response = await api.post(
            "/v1/data-acquisition-runs", params={"dry_run": "true"}, json={"level": COUNTRY}
        )

        _assert_refused_naming("startRun", response, ["query", "dry_run"])
        assert await _runs_recorded(api) == 0, "nothing ran"

    async def test_a_filter_the_server_does_not_apply_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient
    ) -> None:
        """The design declares `pillar` on `listAttributes` and nothing serves it yet, so it
        answered every pillar's attributes to a caller that asked for one."""
        response = await api.get("/v1/attributes", params={"pillar": "housing"})

        _assert_refused_naming("listAttributes", response, ["query", "pillar"])

    async def test_a_declared_query_parameter_is_still_accepted(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.get(
            "/v1/values",
            params={
                "candidate": "country.portugal",
                "include_superseded": "true",
                "limit": 5,
                "offset": 0,
            },
        )

        assert response.status_code == 200

    async def test_a_repeated_list_parameter_is_still_accepted(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100, "comparator_limit": 5})

        response = await api.get(
            "/v1/comparisons",
            params={
                "criteria_set": MINIMAL,
                "level": COUNTRY,
                "focus": "country.portugal",
                "comparators": ["country.greece", "country.spain"],
            },
        )

        assert response.status_code == 200
        assert [side["candidate"] for side in response.json()["comparators"]] == [
            "country.greece",
            "country.spain",
        ]


A_MALFORMED_SET_ID = pytest.mark.parametrize(
    "malformed",
    ["My Set", "a.b", "remote-only", "2026_plan"],
    ids=["a capital and a space", "two segments", "a hyphen", "a leading digit"],
)
"""Shapes `CriteriaSetId` refuses: one segment of lowercase letters, digits and underscores,
starting with a letter (`candidates/identifiers.py`, reached through `CatalogId`)."""


@pytest.fixture
async def a_set_to_discard(api: httpx.AsyncClient) -> AsyncIterator[str]:
    """A well-formed id for a set the test creates, discarded afterwards: the criteria tables
    are not among those the `api` fixture empties."""
    yield "my_set"
    await api.delete("/v1/criteria-sets/my_set")


class TestADomainRefusalIsNot500:
    """A refusal raised while the domain object is built from the request is a 422 (BE-21).

    Pydantic wraps a validator's error in a `ValidationError`, which the error table has no row
    for, so the domain's own sentence -- a malformed id, a home city in the wrong country, a
    period that ends before it begins -- reached the client as a 500. Each case answers in the one
    error shape with the code its domain error maps to, and writes nothing.
    """

    async def test_a_malformed_home_country_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _the_household(api)

        response = await api.put(
            "/v1/household", json={**A_VALID_HOUSEHOLD, "home_country_candidate": "Romania"}
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("replaceHousehold", response.json())
        assert await _the_household(api) == before, "nothing was written"

    async def test_a_home_city_outside_the_home_country_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _the_household(api)

        response = await api.put(
            "/v1/household", json={**A_VALID_HOUSEHOLD, "home_city_candidate": "city.spain.madrid"}
        )

        assert (response.status_code, response.json()["code"]) == (422, "unknown_place")
        _assert_in_the_one_error_shape("replaceHousehold", response.json())
        assert "madrid" in response.json()["message"], "the domain's own sentence comes through"
        assert await _the_household(api) == before, "nothing was written"

    async def test_a_citizenship_at_city_level_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.put(
            "/v1/household", json={**A_VALID_HOUSEHOLD, "citizenships": ["city.romania.cluj"]}
        )

        assert (response.status_code, response.json()["code"]) == (422, "unknown_place")
        _assert_in_the_one_error_shape("replaceHousehold", response.json())

    @pytest.mark.parametrize(
        "threshold",
        [
            {"min_value": 50, "max_value": 10},
            {"min_value": None},
            {"label": "muslim", "max_share": 150},
            {"labels": [{"label": "BWh", "containment_rule": "maybe"}]},
        ],
        ids=["an inverted range", "a range with no bound", "a share of 150", "an unknown rule"],
    )
    async def test_a_threshold_the_domain_refuses_is_refused_not_500(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, threshold: dict
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": threshold},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_criterion")
        _assert_in_the_one_error_shape("updateCriterion", response.json())
        assert await _the_threshold_on_overburden(api, a_scratch_criteria_set) is None

    async def test_a_blank_anchor_label_is_refused_not_500(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"scale_anchors": [_AN_ANCHOR | {"label": " "}, _ANOTHER_ANCHOR]},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_criterion")
        _assert_in_the_one_error_shape("updateCriterion", response.json())

    async def test_a_negative_anchor_score_is_refused_not_500(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"scale_anchors": [_AN_ANCHOR | {"score": -1}, _ANOTHER_ANCHOR]},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("updateCriterion", response.json())

    async def test_a_non_finite_anchor_input_is_refused_not_500(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """JSON has no infinity, but Python's encoder writes one and the parser reads it back."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            content=json.dumps(
                {"scale_anchors": [_AN_ANCHOR | {"input_value": float("inf")}, _ANOTHER_ANCHOR]}
            ),
            headers={"content-type": "application/json"},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("updateCriterion", response.json())

    async def test_an_inverted_period_on_a_manual_value_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _values_stored(api)

        response = await api.post(
            "/v1/values/manual",
            json=A_TYPED_VALUE | {"reference_period": {"start": "2026-12-31", "end": "2026-01-01"}},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_reference_period")
        _assert_in_the_one_error_shape("enterValueManually", response.json())
        assert await _values_stored(api) == before, "nothing was written"

    async def test_a_malformed_breakdown_option_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _values_stored(api)

        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"breakdown_option": "Two Bedrooms"}
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("enterValueManually", response.json())
        assert await _values_stored(api) == before, "nothing was written"

    async def test_an_inverted_period_on_a_gate_answer_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _gate_answers_recorded(api)

        response = await api.put(
            A_GATE_ANSWER_PATH,
            json={
                "match_result": "matching",
                "reference_period": {"start": "2026-12-31", "end": "2026-01-01"},
            },
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_reference_period")
        _assert_in_the_one_error_shape("putMatchRuleResult", response.json())
        assert await _gate_answers_recorded(api) == before, "nothing was recorded"

    async def test_a_gate_answer_dated_without_a_timezone_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        before = await _gate_answers_recorded(api)

        response = await api.put(
            A_GATE_ANSWER_PATH,
            json={"match_result": "matching", "retrieval_date": "2026-09-12T10:00:00"},
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_match_rule_result")
        _assert_in_the_one_error_shape("putMatchRuleResult", response.json())
        assert await _gate_answers_recorded(api) == before, "nothing was recorded"

    async def test_an_empty_override_reason_is_refused_not_500(
        self, api: httpx.AsyncClient
    ) -> None:
        """An override is a reason and a date together; an empty reason is neither."""
        before = await _gate_answers_recorded(api)

        response = await api.put(
            A_GATE_ANSWER_PATH, json={"match_result": "not_matching", "override_reason": ""}
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("putMatchRuleResult", response.json())
        assert await _gate_answers_recorded(api) == before, "nothing was recorded"

    async def test_a_malformed_source_id_is_refused_not_500(self, api: httpx.AsyncClient) -> None:
        """An id that cannot be one is a malformed request (`arch.md` 7.3), not a server fault."""
        response = await api.patch("/v1/data-sources/Eurostat", json={"is_enabled": False})

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("updateDataSource", response.json())

    @A_MALFORMED_SET_ID
    async def test_a_new_set_under_a_malformed_id_is_refused_not_500(
        self, api: httpx.AsyncClient, malformed: str
    ) -> None:
        """`CriteriaSet(id=...)` was built outside `built_from_the_request`, so the identifier's
        own refusal reached the client wrapped in a `ValidationError`: a 500."""
        before = await _criteria_sets_held(api)

        response = await api.post("/v1/criteria-sets", json={"id": malformed, "name": "Mine"})

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("createCriteriaSet", response.json())
        assert malformed in response.json()["message"], "the identifier rule's own sentence"
        assert await _criteria_sets_held(api) == before, "nothing was written"

    async def test_a_new_set_under_a_well_formed_id_is_still_created(
        self, api: httpx.AsyncClient, a_set_to_discard: str
    ) -> None:
        """The control: only the identifier is held to the rule. The name is display text."""
        response = await api.post(
            "/v1/criteria-sets", json={"id": a_set_to_discard, "name": "My Set"}
        )

        assert response.status_code == 201
        validate("createCriteriaSet", response.json(), status=201)
        assert (response.json()["id"], response.json()["name"]) == (a_set_to_discard, "My Set")

    @A_MALFORMED_SET_ID
    async def test_a_copy_under_a_malformed_id_is_refused(
        self, api: httpx.AsyncClient, malformed: str
    ) -> None:
        """The control: `duplicated_as` constructs the identifier itself, so this refusal was
        never wrapped."""
        before = await _criteria_sets_held(api)

        response = await api.post(
            f"/v1/criteria-sets/{MINIMAL}/duplicate", json={"id": malformed, "name": "Mine"}
        )

        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
        _assert_in_the_one_error_shape("duplicateCriteriaSet", response.json())
        assert await _criteria_sets_held(api) == before, "nothing was written"


A_TYPED_VALUE = {
    "candidate": "country.portugal",
    "attribute": "country.naturalisation_pathway",
    "payload": {"magnitude": 5, "unit": "years"},
    "reference_period": {"start": "2026-01-01", "end": "2026-12-31"},
    "retrieval_date": "2026-09-11T10:00:00Z",
}
"""A value of an attribute that declares manual entry, so only what a test changes is wrong."""

A_GATE_ANSWER_PATH = "/v1/match-rule-results/eu_free_movement/country.portugal"

_AN_ANCHOR = {"input_value": 0, "score": 100}
_ANOTHER_ANCHOR = {"input_value": 50, "score": 0}
"""Two anchors that fall as overburden rises, which is what minimising it means."""


async def _the_threshold_on_overburden(api: httpx.AsyncClient, criteria_set: str) -> object:
    body = (await api.get(f"/v1/criteria-sets/{criteria_set}")).json()
    return next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)["matching_threshold"]


async def _the_anchors_on_overburden(api: httpx.AsyncClient, criteria_set: str) -> list:
    body = (await api.get(f"/v1/criteria-sets/{criteria_set}")).json()
    return next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)["scale_anchors"]


async def _runs_recorded(api: httpx.AsyncClient) -> int:
    return (await api.get("/v1/data-acquisition-runs")).json()["total"]


def _assert_refused_naming(operation: str, response: httpx.Response, location: list[str]) -> None:
    """A malformed request: 422 `invalid_request` in the one error shape, saying where."""
    assert response.status_code == 422, f"answered {response.status_code}: {response.text[:120]}"
    assert response.json()["code"] == "invalid_request"
    _assert_in_the_one_error_shape(operation, response.json())
    assert location in [error["location"] for error in response.json()["details"]["errors"]]


async def _the_household(api: httpx.AsyncClient) -> tuple[int, dict]:
    response = await api.get("/v1/household")
    return response.status_code, response.json()


async def _values_stored(api: httpx.AsyncClient) -> int:
    return (await api.get("/v1/values", params={"include_superseded": True})).json()["total"]


async def _gate_answers_recorded(api: httpx.AsyncClient) -> int:
    return len((await api.get("/v1/match-rule-results")).json()["items"])


async def _criteria_sets_held(api: httpx.AsyncClient) -> set[str]:
    return {summary["id"] for summary in (await api.get("/v1/criteria-sets")).json()["items"]}


def _assert_in_the_one_error_shape(operation: str, body: dict) -> None:
    """Hold a 422 to the one `Error` schema the design declares for its operation (`arch.md` 7.6).

    The first line pins that the design declares it at all: `validate` reads an undeclared
    status as nothing to check, so without the pin any body would pass -- which is how these
    went unchecked until every operation declared its 422 (NEW-41). JSON Schema allows a key
    nobody declared, which the last line refuses.
    """
    assert response_schema(operation, 422) == {"$ref": "#/components/schemas/InvalidRequestError"}
    validate(operation, body, status=422)
    assert undeclared_fields(operation, body, status=422) == []


async def _set_the_score_scale(database_url: str, scale: int | None) -> None:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
                (scale,),
            )
