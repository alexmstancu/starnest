"""Values with their provenance, manual entry, and the gates' answers -- over HTTP (W4-E).

Gate B asks that a value's reference date and retrieval date be **displayable**, which means
served; `reqs.md` 6.5 that a value may be typed only where its attribute says so; and `reqs.md`
3.7 that a gate's answer carry its sources and an audited override.
"""

from typing import ClassVar

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


class TestThePageBounds:
    """**The page bounds the contract declares are the bounds the code enforces.**

    `openapi.yaml` gives `limit` a maximum of 1000, and the code took a bare `int`: `?limit=
    100000` served a page the contract says cannot be asked for, and a negative bound went
    straight into `LIMIT`/`OFFSET`, where PostgreSQL refuses it -- a 500 for a request that was
    merely wrong. Both listings take the same parameters and are checked together.
    """

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_a_page_larger_than_the_contract_allows_is_refused(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        response = await api.get(path, params={"limit": 100000})

        assert response.status_code == 422

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_a_negative_page_bound_is_refused_rather_than_reaching_the_database(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        assert (await api.get(path, params={"limit": -1})).status_code == 422
        assert (await api.get(path, params={"offset": -1})).status_code == 422

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_the_largest_page_the_contract_allows_is_served(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        """The control: the bound refuses what is over it, and serves what is on it."""
        response = await api.get(path, params={"limit": 1000, "offset": 0})

        assert response.status_code == 200


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
    async def test_the_decided_rule_carries_its_bounds_and_the_other_carries_none(
        self, api: httpx.AsyncClient
    ) -> None:
        """One of the two has been decided, and the difference is visible over the wire.

        `cheap_but_taxed` got its numbers on 2026-09-19 (`0474`): cheap is a cost of living at
        or below 80 on an index where EU27 is 100, taxed a total rate at or above 40% of the
        whole cost of employment. `mild_now_brutal_later` is still TBD in `reqs.md` 7.4 and
        reads an attribute no source answers, so there is nothing to decide against -- and a
        number invented for it would be the fabricated judgement this application prevents.
        """
        body = (await api.get("/v1/compound-rules", params={"level": "country"})).json()

        rules = {rule["id"]: rule for rule in body["items"]}
        assert set(rules) == {"cheap_but_taxed", "mild_now_brutal_later"}
        assert all(rule["outcome"] == "warning" for rule in rules.values())

        decided = {
            condition["attribute"]: (condition["threshold_min"], condition["threshold_max"])
            for condition in rules["cheap_but_taxed"]["conditions"]
        }
        assert decided == {
            "country.cost_of_living_index": (None, 80),
            "country.total_tax_rate_effective": (40, None),
        }
        assert all(
            condition["threshold_min"] is None and condition["threshold_max"] is None
            for condition in rules["mild_now_brutal_later"]["conditions"]
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


class TestExternalScores:
    async def test_they_come_back_from_their_own_endpoint(
        self, api: httpx.AsyncClient, an_external_score: None
    ) -> None:
        """Separate from `/values` deliberately: an external score is not a measurement of an
        attribute, and a client that could confuse the two would eventually score one
        (`reqs.md` 3.5a)."""
        body = (
            await api.get("/v1/external-scores", params={"candidate": "country.portugal"})
        ).json()

        (score,) = body["items"]
        assert score["data_source"] == "numbeo"
        assert score["published_scale"] == "0-100, higher is safer"
        assert score["caveats"]

    async def test_another_candidates_scores_are_not_returned(
        self, api: httpx.AsyncClient, an_external_score: None
    ) -> None:
        body = (await api.get("/v1/external-scores", params={"candidate": "country.greece"})).json()

        assert body["items"] == []


class TestTheWarningTheHouseholdDecided:
    """`cheap_but_taxed`, end to end: figures in, warning out (`0474`).

    **A warning is the third thing a ranking can say.** It changes neither the score nor the
    match status -- Romania keeps both -- and it says the one thing the score cannot: that the
    cost advantage is partly taken back in tax. The cost-of-living criterion already rewards
    being cheap; this is about the pair.
    """

    @staticmethod
    async def figures_for(database_url: str, pairs: dict[str, tuple[str, str]]) -> None:
        """A cost of living and a total tax rate per country, as the rule reads them."""
        from datetime import UTC, date, datetime
        from decimal import Decimal

        from psycopg_pool import AsyncConnectionPool

        from starnest.data import (
            ConfidenceLevel,
            Index,
            Quantity,
            Ratio,
            ReferencePeriod,
            Value,
            ValueType,
        )
        from starnest.storage import PostgresValueStore

        a_year = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))

        def other(candidate: str, attribute: str, payload: object) -> Value:
            return Value(
                candidate=candidate,
                attribute=attribute,
                value_type=payload.value_type,  # type: ignore[attr-defined]
                data_source="eurostat",
                reference_period=a_year,
                retrieval_date=datetime.now(UTC),
                confidence_level=ConfidenceLevel.HIGH,
                payload=payload,  # type: ignore[arg-type]
            )

        written = []
        for candidate, (cost, tax) in pairs.items():
            # **Six criteria block in the shipped set, and a blocked candidate is never
            # judged by a rule** -- the rules judge a candidate that *could* be scored, so
            # "the tax is high here" is never said about a country whose tax nobody has. Four
            # of the six are nothing to do with this warning and are supplied so the fifth and
            # sixth can be.
            written.extend(
                [
                    other(
                        candidate,
                        "country.political_economic_stability",
                        Index(
                            value=Decimal("0.8"),
                            provider="World Bank WGI",
                            scale_min=Decimal("-2.5"),
                            scale_max=Decimal("2.5"),
                        ),
                    ),
                    other(
                        candidate,
                        "country.rule_of_law",
                        Index(
                            value=Decimal("0.7"),
                            provider="World Bank WGI",
                            scale_min=Decimal("-2.5"),
                            scale_max=Decimal("2.5"),
                        ),
                    ),
                    other(
                        candidate,
                        "country.healthcare_system_quality",
                        Index(
                            value=Decimal(78),
                            provider="WHO UHC",
                            scale_min=Decimal(0),
                            scale_max=Decimal(100),
                        ),
                    ),
                    other(
                        candidate,
                        "country.homicide_rate",
                        Quantity(magnitude=Decimal("1.2"), unit="per_100000_population"),
                    ),
                ]
            )
            written.append(
                Value(
                    candidate=candidate,
                    attribute="country.cost_of_living_index",
                    value_type=ValueType.QUANTITY,
                    data_source="eurostat",
                    reference_period=a_year,
                    retrieval_date=datetime.now(UTC),
                    confidence_level=ConfidenceLevel.HIGH,
                    payload=Quantity(magnitude=Decimal(cost), unit="eu27_average_100"),
                )
            )
            written.append(
                Value(
                    candidate=candidate,
                    attribute="country.total_tax_rate_effective",
                    value_type=ValueType.RATIO,
                    data_source="eurostat",
                    reference_period=a_year,
                    retrieval_date=datetime.now(UTC),
                    confidence_level=ConfidenceLevel.HIGH,
                    payload=Ratio(value=Decimal(tax), basis="labour_cost"),
                )
            )
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                await connection.execute(
                    "INSERT INTO settings (id, score_scale_max) VALUES (1, 100)"
                    " ON CONFLICT (id) DO UPDATE SET score_scale_max = 100, min_coverage = NULL"
                )
            await PostgresValueStore(pool).append(written)

    async def ranked(self, api: httpx.AsyncClient) -> dict:
        body = (
            await api.get(
                "/v1/rankings", params={"criteria_set": "local_employment", "level": COUNTRY}
            )
        ).json()
        return {candidate["candidate"]: candidate for candidate in body["candidates"]}

    # Their own figures, and the four cases the pair of numbers has to tell apart. **Four
    # countries rather than one, because `percentile` cannot place a single candidate**: a
    # column of one has no standing to report, so the blocking criteria could not be scored
    # and nothing was judged at all.
    THE_ROSTER: ClassVar = {
        "country.romania": ("65.1", "42.8"),  # cheap and taxed
        "country.bulgaria": ("62.5", "33.0"),  # cheaper still, and lightly taxed
        "country.poland": ("73.3", "39.2"),  # cheap, and just under the line
        "country.belgium": ("116.2", "58.6"),  # taxed hardest of anybody, and expensive
    }

    async def test_a_cheap_country_taxed_heavily_is_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Romania's own figures: 65.1 on the index, 42.8% of the cost of employment."""
        await self.figures_for(database_url, self.THE_ROSTER)

        romania = (await self.ranked(api))["country.romania"]

        assert [w["compound_rule"] for w in romania["warnings"]] == ["cheap_but_taxed"]
        # The detail carries the figures that made it fire, so a reader can check the judgement
        # rather than take it (`reqs.md` 3.7a).
        assert "65.1" in romania["warnings"][0]["detail"]
        assert "42.8" in romania["warnings"][0]["detail"]

    async def test_it_changes_neither_the_score_nor_the_status(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """**A warning flags; it does not rule out** (`reqs.md` 5.4)."""
        await self.figures_for(database_url, self.THE_ROSTER)

        romania = (await self.ranked(api))["country.romania"]

        assert romania["match_status"] == "matching", romania["insufficient_reason"]
        assert romania["score"] is not None
        assert romania["non_match_reasons"] == []

    async def test_cheap_and_lightly_taxed_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """**Bulgaria is the reason the rule takes two numbers.** It is the cheapest country on
        the roster at 62.5 and taxes at 33%, so the advantage is not taken back -- and a rule
        that warned here would only be saying "cheap", which the criterion already scores."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.bulgaria"]["warnings"] == []

    async def test_expensive_and_heavily_taxed_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Belgium taxes most of anybody at 58.6% and costs 116. Heavy tax alone is not this
        warning: there is no cheapness being taken back."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.belgium"]["warnings"] == []

    async def test_a_country_just_under_the_tax_line_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Poland at 39.2% against a bound of 40. **The boundary is where a threshold either
        means something or does not**, and 0.8 of a percentage point is the whole difference
        between this country and Romania as far as this rule is concerned."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.poland"]["warnings"] == []
