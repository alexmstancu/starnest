"""The LLM path through the API: what it refuses, and what a proposal is (`reqs.md` 6.3, 6.10).

**No model is ever called here.** The gate researcher is a stub and the paid source is the stub
source told to charge -- what is under test is the *application's* rules about money and about
proposals, which hold whoever answers. Whether the real SDK still returns the shape the client
reads is `make live-llm`'s question, and that is the only thing in this repository that spends.
"""

from collections.abc import Sequence
from decimal import Decimal

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import MatchResult, MatchRule
from starnest.data_acquisition import Estimate, GateResearcher, Researched

from .conftest import a_stub_source, an_api

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
A_PAGE = "https://example.gov/skilled-worker"


class StubResearcher(GateResearcher):
    """Answers every gate the same way, citing one page, and prices itself per call."""

    def __init__(self, result: MatchResult = MatchResult.NOT_MATCHING) -> None:
        self._result = result
        self.asked = 0

    def estimate_for(self, calls: int) -> Estimate:
        return Estimate(
            calls=calls, cost_eur=calls * Decimal("0.02"), basis="a stub's flat rate per gate"
        )

    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        self.asked += 1
        return Researched(
            match_result=self._result,
            reason=f"the official page says so for {candidate.name}",
            citations=(A_PAGE,),
            cost_eur=Decimal("0.02"),
            calls=1,
        )


async def _with_a_cap(api: httpx.AsyncClient, cap: float | None) -> None:
    """Settings are **replaced whole**, never patched (`reqs.md` 3.10), so the scale travels with
    the cap. Sending the cap alone unset the score scale and the ranking refused to compute --
    correctly, and it took a confusing minute to see why.
    """
    response = await api.put(
        "/v1/settings",
        json={
            "run_spend_cap_eur": cap,
            "score_scale_max": 100,
            "min_coverage": None,
            "comparator_limit": 5,
        },
    )
    assert response.status_code == 200


async def _with_a_household(api: httpx.AsyncClient) -> None:
    """Gate research reads the citizenships, because they decide every answer (`reqs.md` 7.3):
    free movement, the UK route and the Swiss quota all turn on which passports are held. With
    no household recorded there is nothing to research *for*, and the API says so."""
    response = await api.put(
        "/v1/household",
        json={
            "net_income": 90000,
            "number_adults": 2,
            "number_children": 0,
            "home_country_candidate": "country.romania",
            "citizenships": ["country.romania"],
        },
    )
    assert response.status_code == 200


class TestWhatMoneyRefuses:
    async def test_a_run_that_would_charge_is_refused_without_a_cap(
        self, database_url: str
    ) -> None:
        """Nothing invents a ceiling on the household's behalf."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            refused = await api.post(
                "/v1/data-acquisition-runs", json={"level": COUNTRY, "attributes": [OVERBURDEN]}
            )

        assert refused.status_code == 409
        assert refused.json()["code"] == "spend_cap_not_set"

    async def test_the_household_may_accept_an_uncapped_run_in_the_request(
        self, database_url: str
    ) -> None:
        """The bypass: refused by default, allowed when somebody says so -- per request, never
        remembered."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            accepted = await api.post(
                "/v1/data-acquisition-runs",
                json={
                    "level": COUNTRY,
                    "attributes": [OVERBURDEN],
                    "accept_uncapped_spend": True,
                },
            )

        assert accepted.status_code == 202

    async def test_a_cap_in_the_settings_is_enough(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            await _with_a_cap(api, 5)

            started = await api.post(
                "/v1/data-acquisition-runs", json={"level": COUNTRY, "attributes": [OVERBURDEN]}
            )

        assert started.status_code == 202

    async def test_an_unscoped_run_never_asks_a_paid_source(self, database_url: str) -> None:
        """A sweep of a level asks the free sources for whole indicators. Asking a paid one the
        same way would be hundreds of calls nobody chose, so it is not asked at all -- and with a
        paid source as the only one, the sweep has nothing to fetch and says so rather than
        recording a run that did nothing."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            refused = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_fetch"

    async def test_the_plan_counts_the_same_sources_the_run_would_ask(
        self, database_url: str
    ) -> None:
        """An estimate that promised paid work the run would not do would be worse than none."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            unscoped = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()
            scoped = (
                await api.post(
                    "/v1/data-acquisition-runs/plan",
                    json={"level": COUNTRY, "attributes": [OVERBURDEN]},
                )
            ).json()

        assert unscoped["items_total"] == 0
        assert scoped["items_total"] == 32

    async def test_the_plan_prices_the_paid_work_and_says_what_the_price_rests_on(
        self, database_url: str
    ) -> None:
        """**The estimate before the spend** (`reqs.md` 6.3, Q22). It reported zero for every run
        until now, hardcoded from when every source was free -- so the one screen that exists to
        answer "what will this cost?" answered "nothing", whatever the run was.

        Thirty-two countries at the stub's five cents a call is 1.60, and the basis travels with
        it: a euro figure whose assumptions are not stated can only be trusted, never checked.
        """
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            plan = (
                await api.post(
                    "/v1/data-acquisition-runs/plan",
                    json={"level": COUNTRY, "attributes": [OVERBURDEN]},
                )
            ).json()

        assert plan["llm_call_count"] == 32
        assert plan["estimated_cost_eur"] == pytest.approx(1.60)
        assert "0.05 EUR a call" in plan["estimate_basis"]

    async def test_a_free_run_is_estimated_at_nothing_and_explains_nothing(
        self, database_url: str
    ) -> None:
        """Zero because every source is free, which is the shipped state -- and no basis, because
        there is nothing to explain about zero."""
        async with an_api(database_url, (a_stub_source(),)) as api:
            plan = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()

        assert plan["items_total"] == 64
        assert plan["llm_call_count"] == 0
        assert plan["estimated_cost_eur"] == 0
        assert plan["estimate_basis"] is None


class TestResearchingTheGates:
    async def test_with_no_model_configured_it_says_so_rather_than_succeeding_emptily(
        self, api: httpx.AsyncClient
    ) -> None:
        """An empty success would read as "no gate needed researching"."""
        response = await api.post("/v1/match-rule-research", json={"level": COUNTRY})

        assert response.status_code == 501
        assert response.json()["code"] == "llm_not_configured"

    async def test_it_refuses_without_a_cap_because_it_costs_money(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_household(api)

            refused = await api.post("/v1/match-rule-research", json={"level": COUNTRY})

        assert refused.status_code == 409
        assert refused.json()["code"] == "spend_cap_not_set"

    async def test_it_stores_proposals_with_their_sources(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            outcome = (
                await api.post(
                    "/v1/match-rule-research",
                    json={
                        "level": COUNTRY,
                        "candidates": ["country.portugal"],
                        "match_rules": ["uk_skilled_worker"],
                    },
                )
            ).json()

            stored = (await api.get("/v1/match-rule-results?candidate=country.portugal")).json()

        (proposal,) = outcome["proposals"]
        assert proposal["is_proposal"] is True
        assert proposal["citations"] == [A_PAGE]
        assert outcome["cost_eur"] == pytest.approx(0.02)
        assert [item["match_rule"] for item in stored["items"]] == ["uk_skilled_worker"]

    async def test_a_proposal_rules_nothing_out_until_a_human_writes_it(
        self, database_url: str, a_scratch_criteria_set: str
    ) -> None:
        """The rule the whole use rests on (`reqs.md` 6.10 use 3). The proposal says
        `not_matching`, the gate is enforced, and the candidate still matches -- because nobody
        has looked yet."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)
            await api.put(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/uk_skilled_worker",
                json={"is_enforced": True},
            )
            await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": ["country.portugal"],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

            ranking = (
                await api.get(f"/v1/rankings?criteria_set={a_scratch_criteria_set}&level={COUNTRY}")
            ).json()

        portugal = next(
            row for row in ranking["candidates"] if row["candidate"] == "country.portugal"
        )
        assert portugal["match_status"] != "not_matching"
        assert portugal["non_match_reasons"] == []

    async def test_confirming_it_replaces_the_proposal(
        self, database_url: str, a_scratch_criteria_set: str
    ) -> None:
        """A human writes the same answer as `manual`, and it **replaces** the proposal.

        That replacement is the mechanism: the same (gate, candidate) row now says a person
        answered, so `gates_that_rule_out` counts it -- which is asserted over the evaluation in
        `tests/unit/evaluation/test_rules.py`, where a ranking can be built without thirty-two
        countries' worth of figures behind it.
        """
        # `silent_about=()` so Portugal gets figures: an `insufficient_data` candidate would
        # hide the gate's effect behind a missing score.
        async with an_api(
            database_url, (a_stub_source(silent_about=()),), researcher=StubResearcher()
        ) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)
            await api.put(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/match-rules/uk_skilled_worker",
                json={"is_enforced": True},
            )
            await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": ["country.portugal"],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

            confirmed = await api.put(
                "/v1/match-rule-results/uk_skilled_worker/country.portugal",
                json={
                    "match_result": "not_matching",
                    "reason": "checked the official page myself",
                    "data_source": "manual",
                },
            )

            answers = (await api.get("/v1/match-rule-results?candidate=country.portugal")).json()[
                "items"
            ]

        assert confirmed.json()["is_proposal"] is False
        # One row, not two: confirming **replaces** the proposal rather than sitting beside it,
        # so a proposal and a finding can never disagree about the same gate.
        (answer,) = [row for row in answers if row["match_rule"] == "uk_skilled_worker"]
        assert answer["is_proposal"] is False
        assert answer["data_source"] == "manual"
        assert answer["reason"] == "checked the official page myself"

    async def test_a_confirmed_answer_is_never_researched_again(self, database_url: str) -> None:
        """Paying a model to disagree with somebody who looked is noise with a bill."""
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)
            await api.put(
                "/v1/match-rule-results/uk_skilled_worker/country.portugal",
                json={"match_result": "matching", "data_source": "manual"},
            )

            await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": ["country.portugal"],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

        assert researcher.asked == 0


class TestEstimatingAResearchPassBeforeAgreeingToIt:
    """`reqs.md` 6.3. **The bill before the spend, not after.**

    Research is the most expensive thing this application does -- one call per gate per candidate
    -- and until this existed the only way to learn the cost was to pay it. The estimate counts
    the same pairs the pass would ask about, through the same function, so the two cannot
    disagree about what a pass is.
    """

    async def test_it_prices_every_gate_against_every_candidate(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            plan = (
                await api.post(
                    "/v1/match-rule-research/plan",
                    json={"level": COUNTRY, "match_rules": ["uk_skilled_worker"]},
                )
            ).json()

        assert plan["gates_total"] == 32
        assert plan["llm_call_count"] == 32
        assert plan["estimated_cost_eur"] == pytest.approx(0.64)
        assert "flat rate per gate" in plan["estimate_basis"]

    async def test_it_spends_nothing_and_stores_nothing(self, database_url: str) -> None:
        """The whole point: it is asked *instead* of the pass, not before it."""
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await api.post(
                "/v1/match-rule-research/plan",
                json={"level": COUNTRY, "match_rules": ["uk_skilled_worker"]},
            )

            stored = (await api.get("/v1/match-rule-results")).json()

        assert researcher.asked == 0
        assert stored["items"] == []

    async def test_it_needs_no_cap_because_it_cannot_spend(self, database_url: str) -> None:
        """A refusal here would be the estimate refusing to exist until the thing it estimates
        was already permitted, which is backwards -- the estimate is how the household decides
        what cap to set."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            planned = await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})

        assert planned.status_code == 200

    async def test_a_confirmed_gate_is_not_in_the_estimate(self, database_url: str) -> None:
        """Because it is not in the pass either: paying a model to disagree with somebody who
        looked is noise with a bill, and an estimate that counted it would overstate the work."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await api.put(
                "/v1/match-rule-results/uk_skilled_worker/country.portugal",
                json={"match_result": "matching", "data_source": "manual"},
            )

            plan = (
                await api.post(
                    "/v1/match-rule-research/plan",
                    json={"level": COUNTRY, "match_rules": ["uk_skilled_worker"]},
                )
            ).json()

        assert plan["gates_total"] == 31

    async def test_with_no_model_there_is_nothing_to_estimate(self, api: httpx.AsyncClient) -> None:
        """501, as the pass itself answers: an estimate of zero would read as "this is free"."""
        response = await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})

        assert response.status_code == 501
        assert response.json()["code"] == "llm_not_configured"
