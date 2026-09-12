"""Researching the gates nobody has confirmed (`reqs.md` 6.10 use 3).

**The rule this exists to hold: a model proposes and a human decides.** Every answer is stored as
a proposal, rules nothing out, and is re-asked next time -- while a confirmed answer is never
re-asked, because paying a model to disagree with somebody who looked is not research.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from starnest.candidates import Candidate
from starnest.data import MatchResult, MatchRule, MatchRuleResult
from starnest.data_acquisition import (
    NOTHING,
    Estimate,
    GateResearcher,
    Researched,
    SpendCapNotSetError,
    gates_to_ask,
    plan_research,
    research_gates,
)

COUNTRY = {"id": "country", "depth_order": 1}
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")
A_PAGE = "https://example.gov/route"

THE_GATE = MatchRule(id="uk_skilled_worker", name="UK Skilled Worker route", level="country")
A_CITY_GATE = MatchRule(id="two_role_feasibility", name="Two roles are findable", level="city")


class StubResearcher(GateResearcher):
    """Answers whatever the test queued, and records what it was asked."""

    def __init__(self, *answers: Researched, charges: bool = True) -> None:
        self._answers = list(answers)
        self._charges = charges
        self.asked: list[tuple[str, str]] = []

    @property
    def costs_money(self) -> bool:
        return self._charges

    def estimate_for(self, calls: int) -> Estimate:
        if not self._charges:
            return NOTHING
        return Estimate(calls=calls, cost_eur=calls * Decimal("0.05"), basis="a stub's flat rate")

    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        self.asked.append((str(rule.id), str(candidate.id)))
        if self._answers:
            return self._answers.pop(0)
        return Researched(
            match_result=MatchResult.UNKNOWN, reason="nothing queued", citations=(A_PAGE,)
        )


class RecordingResults:
    """The one method the use case needs, which is why the port is one method wide."""

    def __init__(self) -> None:
        self.recorded: list[MatchRuleResult] = []

    async def record(self, result: MatchRuleResult) -> None:
        self.recorded.append(result)


def a_finding(result: MatchResult = MatchResult.NOT_MATCHING, cost: str = "0.05") -> Researched:
    return Researched(
        match_result=result,
        reason="the official page says so",
        citations=(A_PAGE,),
        cost_eur=Decimal(cost),
        calls=1,
    )


async def researching(
    researcher: StubResearcher,
    *,
    rules: Sequence[MatchRule] = (THE_GATE,),
    candidates: Sequence[Candidate] = (PORTUGAL,),
    answered: Sequence[MatchRuleResult] = (),
    cap: Decimal | None = Decimal(5),
    accepted: bool = False,
):
    store = RecordingResults()
    outcome = await research_gates(
        researcher=researcher,
        rules=list(rules),
        candidates=list(candidates),
        citizenships=["country.romania"],
        results=store,
        already_answered=list(answered),
        spend_cap_eur=cap,
        uncapped_is_accepted=accepted,
    )
    return outcome, store


class TestWhatItStores:
    async def test_a_proposal_with_its_sources(self) -> None:
        outcome, store = await researching(StubResearcher(a_finding()))

        (proposal,) = store.recorded
        assert proposal.is_proposal is True
        assert proposal.citations == (A_PAGE,)
        assert str(proposal.data_source) == "llm"
        assert outcome.proposals == (proposal,)

    async def test_an_answer_that_cited_nothing_is_stored_nowhere(self) -> None:
        """An opinion about a visa route is worth less than an open question."""
        outcome, store = await researching(
            StubResearcher(
                Researched(match_result=MatchResult.NOT_MATCHING, reason="I think", citations=())
            )
        )

        assert store.recorded == []
        assert "cited nothing" in outcome.refusals[0]

    async def test_every_gate_and_candidate_in_scope_is_asked(self) -> None:
        researcher = StubResearcher(a_finding(), a_finding())

        await researching(researcher, candidates=(PORTUGAL, SPAIN))

        assert researcher.asked == [
            ("uk_skilled_worker", "country.portugal"),
            ("uk_skilled_worker", "country.spain"),
        ]

    async def test_a_gate_asked_at_another_level_is_skipped(self) -> None:
        """A city gate is not a question about a country, and asking it would bill for nonsense."""
        researcher = StubResearcher()

        await researching(researcher, rules=(A_CITY_GATE,))

        assert researcher.asked == []


class TestWhatItDoesNotAskAgain:
    async def test_a_confirmed_answer_is_left_alone(self) -> None:
        """Somebody looked and wrote it down. Paying a model to disagree is noise with a bill."""
        confirmed = MatchRuleResult(
            match_rule="uk_skilled_worker",
            candidate="country.portugal",
            match_result=MatchResult.MATCHING,
            data_source="manual",
            retrieval_date=datetime.now(UTC),
            is_proposal=False,
        )
        researcher = StubResearcher()

        await researching(researcher, answered=(confirmed,))

        assert researcher.asked == []

    async def test_a_previous_proposal_is_asked_again(self) -> None:
        """Nothing about a proposal was settled, and the pages may have changed."""
        proposal = MatchRuleResult(
            match_rule="uk_skilled_worker",
            candidate="country.portugal",
            match_result=MatchResult.UNKNOWN,
            data_source="llm",
            retrieval_date=datetime.now(UTC),
            is_proposal=True,
        )
        researcher = StubResearcher(a_finding())

        await researching(researcher, answered=(proposal,))

        assert researcher.asked == [("uk_skilled_worker", "country.portugal")]


class TestMoney:
    async def test_it_reports_what_it_spent(self) -> None:
        outcome, _ = await researching(
            StubResearcher(a_finding(cost="0.05"), a_finding(cost="0.07")),
            candidates=(PORTUGAL, SPAIN),
        )

        assert outcome.cost_eur == Decimal("0.12")
        assert outcome.calls == 2

    async def test_it_halts_at_the_cap_and_keeps_what_it_found(self) -> None:
        outcome, store = await researching(
            StubResearcher(a_finding(cost="1"), a_finding(cost="1")),
            candidates=(PORTUGAL, SPAIN),
            cap=Decimal(1),
        )

        assert outcome.halted_on_spend_cap is True
        assert len(store.recorded) == 1

    async def test_research_with_no_cap_is_refused(self) -> None:
        with pytest.raises(SpendCapNotSetError):
            await researching(StubResearcher(a_finding()), cap=None)

    async def test_research_the_household_accepted_uncapped_proceeds(self) -> None:
        outcome, _ = await researching(StubResearcher(a_finding()), cap=None, accepted=True)

        assert len(outcome.proposals) == 1

    async def test_a_free_researcher_needs_no_cap(self) -> None:
        """Nothing free is refused. A researcher that costs nothing is a researcher nobody has
        to budget for -- and one may exist later."""
        outcome, _ = await researching(StubResearcher(a_finding(cost="0"), charges=False), cap=None)

        assert len(outcome.proposals) == 1


class TestPlanningAPassBeforePayingForIt:
    """**The estimate the household sees before agreeing to spend** (`reqs.md` 6.3, Q22).

    Research is the most expensive thing this application does -- one call per gate per candidate
    -- so the whole value of the estimate is that it counts the *same* pairs the pass would ask
    about. Both go through `gates_to_ask`, which is the only reason they cannot drift.
    """

    def test_it_counts_every_gate_against_every_candidate_it_applies_to(self) -> None:
        estimate = plan_research(
            researcher=StubResearcher(), rules=[THE_GATE], candidates=[PORTUGAL, SPAIN]
        )

        assert estimate.calls == 2
        assert estimate.cost_eur == Decimal("0.10")
        assert estimate.basis == "a stub's flat rate"

    def test_a_gate_asked_at_another_level_is_in_neither_the_plan_nor_the_pass(self) -> None:
        """An estimate promising work the pass would skip is worse than no estimate at all."""
        estimate = plan_research(
            researcher=StubResearcher(), rules=[A_CITY_GATE], candidates=[PORTUGAL, SPAIN]
        )

        assert estimate.calls == 0

    def test_a_confirmed_answer_is_not_estimated_because_it_is_not_asked(self) -> None:
        confirmed = MatchRuleResult(
            match_rule="uk_skilled_worker",
            candidate="country.portugal",
            match_result=MatchResult.MATCHING,
            data_source="manual",
            retrieval_date=datetime.now(UTC),
        )

        estimate = plan_research(
            researcher=StubResearcher(),
            rules=[THE_GATE],
            candidates=[PORTUGAL, SPAIN],
            already_answered=[confirmed],
        )

        assert estimate.calls == 1

    def test_a_previous_proposal_is_estimated_because_it_will_be_asked_again(self) -> None:
        """Nothing about a proposal was settled, so it is asked again -- and an estimate that
        skipped it would under-report the bill."""
        proposal = MatchRuleResult(
            match_rule="uk_skilled_worker",
            candidate="country.portugal",
            match_result=MatchResult.NOT_MATCHING,
            data_source="llm",
            retrieval_date=datetime.now(UTC),
            is_proposal=True,
        )

        estimate = plan_research(
            researcher=StubResearcher(),
            rules=[THE_GATE],
            candidates=[PORTUGAL, SPAIN],
            already_answered=[proposal],
        )

        assert estimate.calls == 2

    async def test_the_plan_and_the_pass_ask_about_the_same_pairs(self) -> None:
        """The property the shared function exists for, asserted rather than assumed."""
        researcher = StubResearcher(a_finding(), a_finding())
        results = RecordingResults()
        planned = plan_research(
            researcher=researcher, rules=[THE_GATE, A_CITY_GATE], candidates=[PORTUGAL, SPAIN]
        )

        outcome = await research_gates(
            researcher=researcher,
            rules=[THE_GATE, A_CITY_GATE],
            candidates=[PORTUGAL, SPAIN],
            citizenships=["country.romania"],
            results=results,
            spend_cap_eur=Decimal(10),
        )

        assert planned.calls == len(researcher.asked) == outcome.calls

    def test_a_free_researcher_plans_no_spend_at_all(self) -> None:
        estimate = plan_research(
            researcher=StubResearcher(charges=False), rules=[THE_GATE], candidates=[PORTUGAL]
        )

        assert estimate == NOTHING

    def test_the_pairs_come_back_in_the_order_they_will_be_asked(self) -> None:
        """Gate by gate, candidate by candidate -- so a pass halted on its cap has covered a
        prefix of the plan rather than an arbitrary subset of it."""
        pairs = gates_to_ask([THE_GATE], [PORTUGAL, SPAIN])

        assert [(str(rule.id), str(candidate.id)) for rule, candidate in pairs] == [
            ("uk_skilled_worker", "country.portugal"),
            ("uk_skilled_worker", "country.spain"),
        ]
