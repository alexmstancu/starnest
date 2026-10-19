"""The LLM path through the API: what it refuses, and what a proposal is (`reqs.md` 6.3, 6.10).

**No model is ever called here.** The gate researcher is a stub and the paid source is the stub
source told to charge -- what is under test is the *application's* rules about money and about
proposals, which hold whoever answers. Whether the real SDK still returns the shape the client
reads is `make live-llm`'s question, and that is the only thing in this repository that spends.
"""

from collections.abc import Sequence
from decimal import Decimal

import httpx
import psycopg
import pytest

from starnest.candidates import Candidate
from starnest.data import MatchResult, MatchRule
from starnest.data_acquisition import Estimate, GateResearcher, Researched

from .conftest import a_stub_source, an_api
from .contract import validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
A_PAGE = "https://example.gov/skilled-worker"
# `0502`: the UK route is researchable and concerns the United Kingdom alone, so a proposal for
# it can only be about this country (NEW-01).
THE_UK = "country.united_kingdom"


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


class AResearcherThatDiesMidPass(StubResearcher):
    """Bills for the first gate it is asked about and dies on the second -- the shape of a
    process killed, or a request abandoned, half way through a pass."""

    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        if self.asked:
            raise RuntimeError("the process died here")
        return await super().research(rule=rule, candidate=candidate, citizenships=citizenships)


async def _the_spend_ledger(database_url: str) -> list[tuple]:
    """What research has been billed, as the ledger holds it (BE-34).

    Read from the table, because nothing reads it through the API: it is write-only by decision,
    and "what has this month cost?" is a question for the database rather than for a screen.
    """
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        cursor = await connection.execute(
            "SELECT match_rule, candidate, data_source, llm_call_count, cost_eur "
            "FROM match_rule_research_spend ORDER BY id"
        )
        return await cursor.fetchall()


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


class TestWhatARetryMaySpend:
    """A retry is a run and spends like one (P41, P42).

    **The path nothing tested against a source that charges.** A retry reaches the sources that
    failed, which is where a paid source is most likely to be, and it was reaching them with no
    cap and no way to ask for one: `retry_run` took no cap at all, and the source it wrapped to
    narrow its attributes reported itself free whatever it actually was.
    """

    @staticmethod
    async def a_run_that_failed_on_a_paid_source(api: httpx.AsyncClient) -> int:
        """Accepted uncapped once, which is how the real one went: the household agrees to a
        first run, and the retry then has to ask again rather than inherit the agreement."""
        started = await api.post(
            "/v1/data-acquisition-runs",
            json={"level": COUNTRY, "attributes": [OVERBURDEN], "accept_uncapped_spend": True},
        )
        assert started.status_code == 202
        return int(started.json()["id"])

    async def test_a_retry_is_refused_without_a_cap(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            first = await self.a_run_that_failed_on_a_paid_source(api)

            refused = await api.post(f"/v1/data-acquisition-runs/{first}/retry")

        assert refused.status_code == 409
        assert refused.json()["code"] == "spend_cap_not_set"

    async def test_a_retry_may_be_accepted_uncapped_in_its_own_request(
        self, database_url: str
    ) -> None:
        """Per request, never remembered -- so the acceptance has to be repeated here, and there
        has to be somewhere to say it."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            first = await self.a_run_that_failed_on_a_paid_source(api)

            accepted = await api.post(
                f"/v1/data-acquisition-runs/{first}/retry",
                json={"items": "failed", "accept_uncapped_spend": True},
            )

        assert accepted.status_code == 202

    async def test_a_retry_proceeds_under_a_cap_the_household_has_set(
        self, database_url: str
    ) -> None:
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            first = await self.a_run_that_failed_on_a_paid_source(api)
            await _with_a_cap(api, 5)

            retried = await api.post(f"/v1/data-acquisition-runs/{first}/retry")

        assert retried.status_code == 202

    async def test_a_retry_of_free_sources_needs_no_cap(self, database_url: str) -> None:
        """The control. Every source shipped today is free, and this is the path they take."""
        async with an_api(database_url, (a_stub_source(),)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()[
                "id"
            ]

            retried = await api.post(f"/v1/data-acquisition-runs/{first}/retry")

        assert retried.status_code == 202


class TestResearchingTheGates:
    async def test_with_no_model_configured_it_says_so_rather_than_succeeding_emptily(
        self, api: httpx.AsyncClient
    ) -> None:
        """An empty success would read as "no gate needed researching"."""
        response = await api.post("/v1/match-rule-research", json={"level": COUNTRY})

        assert response.status_code == 501
        assert response.json()["code"] == "llm_not_configured"

    async def test_it_refuses_when_the_llm_source_is_switched_off(self, database_url: str) -> None:
        """Gate research is the paid LLM path, so switching the `llm` source off must stop it
        spending -- it used to check only that a model was configured, never the toggle (BE-15).
        Restored in `finally`, because the catalog is shared across the suite."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)
            await api.patch("/v1/data-sources/llm", json={"is_enabled": False})
            try:
                refused = await api.post("/v1/match-rule-research", json={"level": COUNTRY})
            finally:
                await api.patch("/v1/data-sources/llm", json={"is_enabled": True})

        assert refused.status_code == 501
        assert refused.json()["code"] == "llm_not_configured"
        assert "switched off" in refused.json()["message"]

    async def test_it_refuses_without_a_cap_because_it_costs_money(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_household(api)

            refused = await api.post("/v1/match-rule-research", json={"level": COUNTRY})

        assert refused.status_code == 409
        assert refused.json()["code"] == "spend_cap_not_set"

    async def test_a_gate_research_cannot_answer_asks_nothing_and_refuses_nothing(
        self, database_url: str
    ) -> None:
        """NEW-01. Free movement is definitional (`reqs.md` 7.3), so the pass has nothing to ask
        and nothing to spend -- not even a cap to require, though none is set here."""
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await _with_a_household(api)

            response = await api.post(
                "/v1/match-rule-research",
                json={"level": COUNTRY, "match_rules": ["eu_free_movement"]},
            )
            stored = (await api.get("/v1/match-rule-results")).json()["items"]

        assert response.status_code == 200, f"answered {response.status_code}: {response.text}"
        body = response.json()
        assert (body["proposals"], body["refusals"], body["calls"]) == ([], [], 0)
        assert body["cost_eur"] == 0
        assert researcher.asked == 0
        assert stored == []
        validate("researchMatchRules", body)

    async def test_it_stores_proposals_with_their_sources(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            outcome = (
                await api.post(
                    "/v1/match-rule-research",
                    json={
                        "level": COUNTRY,
                        "candidates": [THE_UK],
                        "match_rules": ["uk_skilled_worker"],
                    },
                )
            ).json()

            stored = (await api.get(f"/v1/match-rule-results?candidate={THE_UK}")).json()

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
            researched = await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": [THE_UK],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

            ranking = (
                await api.get(f"/v1/rankings?criteria_set={a_scratch_criteria_set}&level={COUNTRY}")
            ).json()

        # The proposal exists -- otherwise "rules nothing out" would hold of nothing at all.
        (proposal,) = researched.json()["proposals"]
        assert proposal["match_result"] == "not_matching"
        united_kingdom = next(row for row in ranking["candidates"] if row["candidate"] == THE_UK)
        assert united_kingdom["match_status"] != "not_matching"
        assert united_kingdom["non_match_reasons"] == []

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
            researched = await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": [THE_UK],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

            confirmed = await api.put(
                f"/v1/match-rule-results/uk_skilled_worker/{THE_UK}",
                json={
                    "match_result": "not_matching",
                    "reason": "checked the official page myself",
                    "data_source": "manual",
                },
            )

            answers = (await api.get(f"/v1/match-rule-results?candidate={THE_UK}")).json()["items"]

        # There was a proposal to replace: research asked the one country the route concerns.
        assert len(researched.json()["proposals"]) == 1

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
                f"/v1/match-rule-results/uk_skilled_worker/{THE_UK}",
                json={"match_result": "matching", "data_source": "manual"},
            )

            await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": [THE_UK],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

        assert researcher.asked == 0


class TestWhatResearchSpentIsKept:
    """BE-34, revisiting Q224. Research writes gate answers, not figures, so it is not a run and
    its cost reached only the response and the log. A response lost to a timeout, or a pass that
    died, took the only record of what it had cost with it. Each billed call is now a row."""

    async def test_what_research_spent_is_on_record_even_when_the_pass_dies(
        self, database_url: str
    ) -> None:
        researcher = AResearcherThatDiesMidPass()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            with pytest.raises(RuntimeError, match="the process died"):
                await api.post("/v1/match-rule-research", json={"level": COUNTRY})

            ledger = await _the_spend_ledger(database_url)

        assert ledger == [("ch_eu_efta_quota", "country.switzerland", "llm", 1, Decimal("0.02"))]

    async def test_a_finished_pass_keeps_one_row_for_every_call_it_paid_for(
        self, database_url: str
    ) -> None:
        """And the rows add up to what the response reported, so the two accounts agree."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            outcome = (await api.post("/v1/match-rule-research", json={"level": COUNTRY})).json()
            ledger = await _the_spend_ledger(database_url)

        assert [(gate, candidate) for gate, candidate, *_ in ledger] == [
            ("ch_eu_efta_quota", "country.switzerland"),
            ("li_eea_quota", "country.liechtenstein"),
            ("uk_skilled_worker", "country.united_kingdom"),
        ]
        assert sum(cost for *_, cost in ledger) == pytest.approx(Decimal(str(outcome["cost_eur"])))
        assert sum(calls for *_, calls, _cost in ledger) == outcome["calls"]

    async def test_an_estimate_spends_nothing_and_so_ledgers_nothing(
        self, database_url: str
    ) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})

            ledger = await _the_spend_ledger(database_url)

        assert ledger == []


class TestEstimatingAResearchPassBeforeAgreeingToIt:
    """`reqs.md` 6.3. **The bill before the spend, not after.**

    Research is the most expensive thing this application does -- one call per gate per candidate
    -- and until this existed the only way to learn the cost was to pay it. The estimate counts
    the same pairs the pass would ask about, through the same function, so the two cannot
    disagree about what a pass is.
    """

    async def test_it_prices_a_gate_only_for_the_country_it_concerns(
        self, database_url: str
    ) -> None:
        """NEW-01. The UK route was priced against all thirty-two countries; it concerns one."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            plan = (
                await api.post(
                    "/v1/match-rule-research/plan",
                    json={"level": COUNTRY, "match_rules": ["uk_skilled_worker"]},
                )
            ).json()

        assert plan["gates_total"] == 1
        assert plan["llm_call_count"] == 1
        assert plan["estimated_cost_eur"] == pytest.approx(0.02)
        assert "flat rate per gate" in plan["estimate_basis"]

    async def test_a_pass_over_the_whole_level_is_three_questions(self, database_url: str) -> None:
        """NEW-01. Five gates against thirty-two countries was 160 paid calls. Three gates are
        answered by reading official pages (`reqs.md` 7.3), and each concerns one country."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            plan = (await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})).json()

        assert (plan["gates_total"], plan["llm_call_count"]) == (3, 3)
        assert plan["estimated_cost_eur"] == pytest.approx(0.06)

    async def test_a_gate_research_cannot_answer_is_estimated_at_nothing(
        self, database_url: str
    ) -> None:
        """Not refused: the page asks one gate per request, including the two with nothing to
        ask, and a refusal there would read as a fault rather than as nothing to do."""
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            planned = await api.post(
                "/v1/match-rule-research/plan",
                json={"level": COUNTRY, "match_rules": ["eu_free_movement"]},
            )

        assert planned.status_code == 200
        assert (planned.json()["gates_total"], planned.json()["estimated_cost_eur"]) == (0, 0)

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
                f"/v1/match-rule-results/uk_skilled_worker/{THE_UK}",
                json={"match_result": "matching", "data_source": "manual"},
            )

            plan = (await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})).json()

        assert plan["gates_total"] == 2

    async def test_with_no_model_there_is_nothing_to_estimate(self, api: httpx.AsyncClient) -> None:
        """501, as the pass itself answers: an estimate of zero would read as "this is free"."""
        response = await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})

        assert response.status_code == 501
        assert response.json()["code"] == "llm_not_configured"

    async def test_with_the_llm_source_switched_off_there_is_nothing_to_estimate(
        self, database_url: str
    ) -> None:
        """The pass refuses when the `llm` source is off (BE-15), so the estimate must too: it
        used to price a pass the household could not then run (NEW-03). Restored in `finally`,
        because the catalog is shared across the suite."""
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await api.patch("/v1/data-sources/llm", json={"is_enabled": False})
            try:
                refused = await api.post("/v1/match-rule-research/plan", json={"level": COUNTRY})
            finally:
                await api.patch("/v1/data-sources/llm", json={"is_enabled": True})

        assert refused.status_code == 501
        assert refused.json()["code"] == "llm_not_configured"
        assert "switched off" in refused.json()["message"]
        assert researcher.asked == 0


class TestResearchRefusesAnUnknownScope:
    """BE-24, on the paid path. A misspelled gate or candidate used to fall out of the
    intersection with what exists, so a research pass asked a model about -- and billed for -- a
    smaller scope than was requested, concealing the drop. Now the scope is refused and every
    unknown id is named, before anything is asked."""

    async def test_the_pass_refuses_an_unknown_candidate_and_spends_nothing(
        self, database_url: str
    ) -> None:
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            response = await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": ["country.portugal", "country.narnia"],
                    "match_rules": ["uk_skilled_worker"],
                },
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "unknown_scope"
        assert body["details"]["unknown_candidates"] == ["country.narnia"]
        assert researcher.asked == 0

    async def test_the_estimate_refuses_an_unknown_gate(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            response = await api.post(
                "/v1/match-rule-research/plan",
                json={"level": COUNTRY, "match_rules": ["uk_skilled_worker", "no_such_gate"]},
            )

        assert response.status_code == 422
        assert response.json()["details"]["unknown_match_rules"] == ["no_such_gate"]


class TestResearchRefusesAFieldItDoesNotDeclare:
    """BE-23, on the paid path. A misspelled `match_rules` was dropped, and a scope naming no
    gates means every gate asked at the level -- so a pass meant for one gate researched, and
    billed for, all of them."""

    async def test_the_pass_refuses_a_misspelled_gate_list_and_asks_nothing(
        self, database_url: str
    ) -> None:
        researcher = StubResearcher()
        async with an_api(database_url, (a_stub_source(),), researcher=researcher) as api:
            await _with_a_cap(api, 50)
            await _with_a_household(api)

            response = await api.post(
                "/v1/match-rule-research",
                json={
                    "level": COUNTRY,
                    "candidates": ["country.portugal"],
                    "match_rule": ["uk_skilled_worker"],
                },
            )
            stored = (await api.get("/v1/match-rule-results")).json()["items"]

        assert response.status_code == 422, f"answered {response.status_code}: {response.text[:80]}"
        assert response.json()["code"] == "invalid_request"
        validate("researchMatchRules", response.json(), status=422)
        assert ["body", "match_rule"] in [
            e["location"] for e in response.json()["details"]["errors"]
        ]
        assert researcher.asked == 0
        assert stored == []

    async def test_the_estimate_refuses_it_too(self, database_url: str) -> None:
        async with an_api(database_url, (a_stub_source(),), researcher=StubResearcher()) as api:
            response = await api.post(
                "/v1/match-rule-research/plan",
                json={"level": COUNTRY, "match_rule": ["uk_skilled_worker"]},
            )

        assert response.status_code == 422, f"answered {response.status_code}: {response.text[:80]}"
        assert response.json()["code"] == "invalid_request"
        validate("planMatchRuleResearch", response.json(), status=422)
