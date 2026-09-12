"""Values with their provenance, manual entry, and the gates' answers -- over HTTP (W4-E).

Gate B asks that a value's reference date and retrieval date be **displayable**, which means
served; `reqs.md` 6.5 that a value may be typed only where its attribute says so; and `reqs.md`
3.7 that a gate's answer carry its sources and an audited override.
"""

import httpx
import pytest

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
NATURALISATION = "country.naturalisation_pathway"
"""A Quantity in years that declares manual entry: no dataset publishes it (`reqs.md` 6.9)."""

OVERBURDEN = "country.housing_cost_overburden_rate"
"""Declares no manual entry: its values come from Eurostat."""

A_TYPED_VALUE = {
    "candidate": "country.portugal",
    "attribute": NATURALISATION,
    "payload": {"magnitude": 5, "unit": "years"},
    "reference_period": {"start": "2026-01-01", "end": "2026-12-31"},
    "retrieval_date": "2026-09-11T10:00:00Z",
    "quote": "Lei da Nacionalidade, art. 6: five years of legal residence",
    "citations": ["https://www.pgdlisboa.pt/leis/lei_mostra_articulado.php?nid=614"],
}


class TestReadingValues:
    async def test_both_dates_come_back_and_are_not_the_same_thing(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """The period a figure describes and the moment it was fetched, never merged
        (`reqs.md` 3.6) -- Gate B's "both displayable"."""
        body = (await api.get("/v1/values", params={"candidate": "country.portugal"})).json()

        value = body["items"][0]
        assert value["reference_period"] == {"start": "2025-01-01", "end": "2025-12-31"}
        assert value["retrieval_date"].startswith("20")
        assert value["retrieval_date"][:10] != value["reference_period"]["start"]

    async def test_by_default_only_the_value_being_scored_comes_back(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        await api.post("/v1/values/manual", json=A_TYPED_VALUE)
        await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"retrieval_date": "2026-09-10T10:00:00Z"}
        )

        active = (
            await api.get(
                "/v1/values", params={"candidate": "country.portugal", "attribute": NATURALISATION}
            )
        ).json()
        everything = (
            await api.get(
                "/v1/values",
                params={
                    "candidate": "country.portugal",
                    "attribute": NATURALISATION,
                    "include_superseded": True,
                },
            )
        ).json()

        assert [value["is_active"] for value in active["items"]] == [True]
        assert active["total"] == 1
        assert sorted(value["is_active"] for value in everything["items"]) == [False, True]
        assert everything["total"] == 2

    async def test_a_payload_carries_numbers_not_strings(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (await api.get("/v1/values", params={"attribute": OVERBURDEN})).json()

        assert all(isinstance(value["payload"]["value"], int | float) for value in body["items"])


class TestTypingAValue:
    async def test_it_is_stored_under_the_manual_source_at_medium_confidence(
        self, api: httpx.AsyncClient
    ) -> None:
        """Medium by default: a source tier says nothing useful about a typed value, so the
        default is a deliberately unflattering middle (`reqs.md` 5.7)."""
        response = await api.post("/v1/values/manual", json=A_TYPED_VALUE)

        assert response.status_code == 201
        stored = response.json()
        assert stored["data_source"] == "manual"
        assert stored["confidence_level"] == "medium"
        assert stored["payload"] == {"magnitude": 5, "unit": "years"}
        assert stored["citations"] == A_TYPED_VALUE["citations"]
        assert stored["is_active"] is True

    async def test_an_attribute_that_does_not_declare_manual_entry_refuses_it(
        self, api: httpx.AsyncClient
    ) -> None:
        """The fastest route to a plausible number with no measurement behind it is an open
        field; the attribute has to have said yes (`reqs.md` 6.5)."""
        response = await api.post(
            "/v1/values/manual",
            json=A_TYPED_VALUE
            | {"attribute": OVERBURDEN, "payload": {"value": 5, "basis": "households"}},
        )

        assert response.status_code == 409
        assert response.json()["code"] == "manual_entry_not_permitted"

    async def test_a_value_of_the_wrong_shape_is_refused_and_says_why(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"payload": {"labels": ["five years"]}}
        )

        assert response.status_code == 409
        assert response.json()["code"] == "invalid_value"
        assert "Quantity" in response.json()["message"]

    async def test_a_candidate_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"candidate": "country.atlantis"}
        )

        assert response.status_code == 404

    async def test_an_attribute_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"attribute": "country.happiness"}
        )

        assert response.status_code == 404


class TestTheGates:
    async def test_every_gate_comes_back_and_one_is_asked_at_every_level(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get("/v1/match-rules", params={"level": "country"})).json()

        levels = {rule["id"]: rule["level"] for rule in body["items"]}
        assert levels["uk_skilled_worker"] == "country"
        assert levels["not_manually_excluded"] is None

    async def test_an_answer_is_recorded_and_read_back_with_its_pages(
        self, api: httpx.AsyncClient
    ) -> None:
        answer = {
            "match_result": "matching",
            "reason": "Romanian citizens move freely within the EU",
            "citations": ["https://eur-lex.europa.eu/eli/dir/2004/38/oj"],
        }

        put = await api.put("/v1/match-rule-results/eu_free_movement/country.portugal", json=answer)
        listed = (
            await api.get("/v1/match-rule-results", params={"candidate": "country.portugal"})
        ).json()

        assert put.status_code == 200
        (stored,) = listed["items"]
        assert stored["match_result"] == "matching"
        assert stored["citations"] == answer["citations"]
        assert stored["data_source"] == "manual"
        assert stored["override_date"] is None

    async def test_an_override_is_dated_by_the_server_not_the_client(
        self, api: httpx.AsyncClient
    ) -> None:
        """An audit trail whose dates the audited party supplies is not one (`reqs.md` 3.7)."""
        response = await api.put(
            "/v1/match-rule-results/not_manually_excluded/country.greece",
            json={"match_result": "not_matching", "override_reason": "ruled out by hand: heat"},
        )

        assert response.json()["override_reason"] == "ruled out by hand: heat"
        assert response.json()["override_date"] is not None

    async def test_a_new_answer_replaces_the_old_one_and_its_pages(
        self, api: httpx.AsyncClient
    ) -> None:
        path = "/v1/match-rule-results/uk_skilled_worker/country.united_kingdom"
        await api.put(
            path, json={"match_result": "unknown", "citations": ["https://example.org/old"]}
        )

        await api.put(
            path, json={"match_result": "matching", "citations": ["https://example.org/new"]}
        )

        (answer,) = (
            await api.get("/v1/match-rule-results", params={"match_rule": "uk_skilled_worker"})
        ).json()["items"]
        assert answer["match_result"] == "matching"
        assert answer["citations"] == ["https://example.org/new"]

    @pytest.mark.parametrize(
        ("path", "status"),
        [
            ("/v1/match-rule-results/no_such_gate/country.portugal", 404),
            ("/v1/match-rule-results/eu_free_movement/country.atlantis", 404),
        ],
        ids=["an unknown gate", "an unknown candidate"],
    )
    async def test_naming_what_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient, path: str, status: int
    ) -> None:
        response = await api.put(path, json={"match_result": "matching"})

        assert response.status_code == status

    async def test_an_unknown_source_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put(
            "/v1/match-rule-results/eu_free_movement/country.portugal",
            json={"match_result": "matching", "data_source": "a_blog"},
        )

        assert response.status_code == 422
        assert response.json()["code"] == "unknown_data_source"


class TestTheCompoundRules:
    async def test_both_shipped_rules_come_back_undecided(self, api: httpx.AsyncClient) -> None:
        """`reqs.md` 7.4 leaves every threshold TBD, so both are listed with no bounds and
        fire nothing. A rule fired on a number nobody chose is the fabricated judgement this
        application exists to prevent."""
        body = (await api.get("/v1/compound-rules", params={"level": "country"})).json()

        rules = {rule["id"]: rule for rule in body["items"]}
        assert set(rules) == {"cheap_but_taxed", "mild_now_brutal_later"}
        assert all(rule["outcome"] == "warning" for rule in rules.values())
        assert all(
            condition["threshold_min"] is None and condition["threshold_max"] is None
            for rule in rules.values()
            for condition in rule["conditions"]
        )

    async def test_each_rule_names_the_attributes_it_reads(self, api: httpx.AsyncClient) -> None:
        body = (await api.get("/v1/compound-rules")).json()

        cheap = next(rule for rule in body["items"] if rule["id"] == "cheap_but_taxed")
        assert [condition["attribute"] for condition in cheap["conditions"]] == [
            "country.cost_of_living_index",
            "country.total_tax_rate_effective",
        ]

    async def test_an_undecided_rule_warns_nobody_in_a_ranking(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (
            await api.get("/v1/rankings", params={"criteria_set": "minimal", "level": COUNTRY})
        ).json()

        assert all(candidate["warnings"] == [] for candidate in body["candidates"])
