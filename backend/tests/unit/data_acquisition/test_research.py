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
SWITZERLAND = Candidate(
    id="country.switzerland", name="Switzerland", level=COUNTRY, country_code="CH"
)
A_PAGE = "https://example.gov/route"

# Researchable and concerning every candidate, so the tests below that are about something else
# -- money, confirmation, order -- are not narrowed by which candidates a gate concerns (NEW-01).
THE_GATE = MatchRule(
    id="uk_skilled_worker", name="UK Skilled Worker route", level="country", researchable=True
)
A_CITY_GATE = MatchRule(
    id="two_role_feasibility", name="Two roles are findable", level="city", researchable=True
)
# `reqs.md` 7.3: definitional, read from the household's citizenship. Nothing to research.
A_DEFINITIONAL_GATE = MatchRule(id="eu_free_movement", name="EU/EEA free movement", level="country")
# Researchable, and a question about one country only.
THE_SWISS_QUOTA = MatchRule(
    id="ch_eu_efta_quota",
    name="Swiss EU/EFTA permit quota",
    level="country",
    researchable=True,
    concerned_candidates=("country.switzerland",),
)


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
    """The one method the use case needs, which is why the port is one method wide. It answers
    whether it stored the result, as the real store does (NEW-63)."""

    def __init__(self) -> None:
        self.recorded: list[MatchRuleResult] = []

    async def record(self, result: MatchRuleResult) -> bool:
        self.recorded.append(result)
        return True


class AStoreAPersonGotToFirst(RecordingResults):
    """Declines the proposal for a candidate a person answered while the pass ran, as the store
    does (NEW-02) -- for every candidate, unless some are named."""

    def __init__(self, *answered_for: str) -> None:
        super().__init__()
        self._answered_for = set(answered_for)

    async def record(self, result: MatchRuleResult) -> bool:
        if self._answered_for and str(result.candidate) not in self._answered_for:
            return await super().record(result)
        return False


class AStoreThatFails(RecordingResults):
    """Fails on every write, as a store does when its database goes away mid-pass."""

    async def record(self, result: MatchRuleResult) -> bool:
        raise RuntimeError("the database went away")


class RecordingLedger:
    """Keeps what each research call billed, in the order it was written (BE-34)."""

    def __init__(self) -> None:
        self.recorded: list = []

    async def record_research_spend(self, spend) -> None:  # type: ignore[no-untyped-def]
        self.recorded.append(spend)


class AResearcherThatDies(StubResearcher):
    """Answers the first question it is asked and dies on the second, which is the shape of a
    process killed mid-pass."""

    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        if self.asked:
            raise RuntimeError("the process died here")
        return await super().research(rule=rule, candidate=candidate, citizenships=citizenships)


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

    async def test_a_declined_proposal_does_not_stop_the_pass(self) -> None:
        """A person answered while the pass ran (NEW-02). Nothing about the next gate changed,
        so the pass goes on asking (NEW-36 refuses only the endpoint that takes an answer)."""
        researcher = StubResearcher(a_finding(), a_finding())

        outcome = await research_gates(
            researcher=researcher,
            rules=[THE_GATE],
            candidates=[PORTUGAL, SPAIN],
            citizenships=["country.romania"],
            results=AStoreAPersonGotToFirst(),
            already_answered=[],
            spend_cap_eur=Decimal(5),
            uncapped_is_accepted=False,
        )

        assert researcher.asked == [
            ("uk_skilled_worker", "country.portugal"),
            ("uk_skilled_worker", "country.spain"),
        ]
        assert outcome.calls == 2

    async def test_a_declined_proposal_is_not_listed_as_a_proposal(self) -> None:
        """NEW-63. The response listed it as though it stood, beside the person's answer the
        store had kept instead."""
        outcome = await research_gates(
            researcher=StubResearcher(a_finding(), a_finding()),
            rules=[THE_GATE],
            candidates=[PORTUGAL, SPAIN],
            citizenships=["country.romania"],
            results=AStoreAPersonGotToFirst("country.spain"),
            spend_cap_eur=Decimal(5),
        )

        assert [str(proposal.candidate) for proposal in outcome.proposals] == ["country.portugal"]

    async def test_a_declined_proposal_is_reported_because_it_was_billed(self) -> None:
        """Not listed, and not hidden either: the call cost money, so the response says what it
        bought and why nothing was kept."""
        outcome = await research_gates(
            researcher=StubResearcher(a_finding(cost="0.05")),
            rules=[THE_GATE],
            candidates=[PORTUGAL],
            citizenships=["country.romania"],
            results=AStoreAPersonGotToFirst(),
            spend_cap_eur=Decimal(5),
        )

        (refusal,) = outcome.refusals
        assert refusal == (
            "uk_skilled_worker for country.portugal: a person answered this gate while the "
            "pass ran, so the proposal was not stored"
        )
        assert (outcome.proposals, outcome.calls, outcome.cost_eur) == ((), 1, Decimal("0.05"))

    async def test_an_answer_that_cited_nothing_is_stored_nowhere(self) -> None:
        """An opinion about a visa route is worth less than an open question."""
        outcome, store = await researching(
            StubResearcher(
                Researched(match_result=MatchResult.NOT_MATCHING, reason="I think", citations=())
            )
        )

        assert store.recorded == []
        assert "cited nothing" in outcome.refusals[0]

    async def test_a_refusal_carries_the_researchers_own_reason(self) -> None:
        """NEW-16. A model that could not be reached cited nothing too, and a refusal saying
        only that hid the reason a person would act on -- here, to try again later."""
        outcome, _ = await researching(
            StubResearcher(
                Researched(
                    match_result=MatchResult.UNKNOWN,
                    reason="the model could not be reached: 429 rate limited",
                    citations=(),
                )
            )
        )

        (refusal,) = outcome.refusals
        assert refusal.startswith("uk_skilled_worker for country.portugal: ")
        assert "the model could not be reached: 429 rate limited" in refusal

    async def test_a_refusal_with_no_reason_from_the_researcher_says_so(self) -> None:
        """A model may cite nothing and explain nothing; the refusal then says that no reason
        was given, rather than trailing off where the reason would be."""
        outcome, _ = await researching(
            StubResearcher(Researched(match_result=MatchResult.UNKNOWN, reason="", citations=()))
        )

        (refusal,) = outcome.refusals
        assert "no reason given" in refusal

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


class TestWhatResearchCanAnswer:
    """NEW-01. **Only a gate the catalog marks researchable is asked, and only about the
    candidates it concerns** (`reqs.md` 7.3). Every gate was asked about every candidate: five
    country gates over thirty-two countries, 160 paid calls, where three gates are answered by
    reading official pages and each of those concerns one country."""

    async def test_a_gate_research_cannot_answer_is_never_asked(self) -> None:
        """Free movement is read from the household's citizenship; a model asked about it is
        billed for an answer nobody can use."""
        researcher = StubResearcher()

        outcome, store = await researching(
            researcher, rules=(A_DEFINITIONAL_GATE,), candidates=(PORTUGAL, SPAIN)
        )

        assert researcher.asked == []
        assert (outcome.calls, outcome.cost_eur, outcome.refusals) == (0, Decimal(0), ())
        assert store.recorded == []

    async def test_a_gate_is_asked_only_about_the_candidates_it_concerns(self) -> None:
        researcher = StubResearcher(a_finding())

        outcome, _ = await researching(
            researcher, rules=(THE_SWISS_QUOTA,), candidates=(PORTUGAL, SWITZERLAND, SPAIN)
        )

        assert researcher.asked == [("ch_eu_efta_quota", "country.switzerland")]
        assert [str(proposal.candidate) for proposal in outcome.proposals] == [
            "country.switzerland"
        ]

    async def test_a_gate_concerning_no_candidate_in_scope_asks_nothing(self) -> None:
        """The edge: a scope that names only places the gate is not about."""
        researcher = StubResearcher()

        outcome, store = await researching(
            researcher, rules=(THE_SWISS_QUOTA,), candidates=(PORTUGAL, SPAIN)
        )

        assert researcher.asked == []
        assert (outcome.calls, outcome.proposals) == (0, ())
        assert store.recorded == []

    async def test_a_confirmed_answer_about_a_concerned_candidate_is_still_never_asked(
        self,
    ) -> None:
        """Narrowing the scope must not loosen the older rule: somebody looked."""
        confirmed = MatchRuleResult(
            match_rule="ch_eu_efta_quota",
            candidate="country.switzerland",
            match_result=MatchResult.MATCHING,
            data_source="manual",
            retrieval_date=datetime.now(UTC),
        )
        researcher = StubResearcher()

        await researching(
            researcher,
            rules=(THE_SWISS_QUOTA,),
            candidates=(SWITZERLAND,),
            answered=(confirmed,),
        )

        assert researcher.asked == []

    async def test_a_pass_with_nothing_to_ask_needs_no_cap(self) -> None:
        """A pass that asks nothing spends nothing, so refusing it for want of a cap would refuse
        a free request -- and the page sends one per gate of the level, including the two that
        have nothing to ask. A pass with something to ask is still refused (`TestMoney`)."""
        researcher = StubResearcher()

        outcome, _ = await researching(
            researcher, rules=(A_DEFINITIONAL_GATE, THE_SWISS_QUOTA), cap=None
        )

        assert researcher.asked == []
        assert (outcome.calls, outcome.halted_on_spend_cap) == (0, False)


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


async def researching_into(
    ledger: RecordingLedger,
    researcher: StubResearcher,
    *,
    results: RecordingResults | None = None,
    candidates: Sequence[Candidate] = (PORTUGAL,),
    cap: Decimal = Decimal(5),
):
    return await research_gates(
        researcher=researcher,
        rules=[THE_GATE],
        candidates=list(candidates),
        citizenships=["country.romania"],
        results=results or RecordingResults(),
        spend_cap_eur=cap,
        ledger=ledger,
    )


class TestTheSpendLedger:
    """BE-34, revisiting Q224. **What research spent is written as it is spent.**

    The meter lived as long as the request, so a pass that died -- or a response the page never
    received -- took the only record of what it had cost with it. Every call that billed anything
    is written the moment the researcher returns: before its proposal is stored, and before the
    next question is asked.
    """

    async def test_every_billed_answer_is_recorded_before_the_next_question(self) -> None:
        """The first question bills 0.05 and the second kills the pass; the first stays kept."""
        ledger = RecordingLedger()

        with pytest.raises(RuntimeError, match="the process died"):
            await researching_into(
                ledger, AResearcherThatDies(a_finding(cost="0.05")), candidates=(PORTUGAL, SPAIN)
            )

        (spend,) = ledger.recorded
        assert (str(spend.match_rule), str(spend.candidate), str(spend.data_source)) == (
            "uk_skilled_worker",
            "country.portugal",
            "llm",
        )
        assert (spend.llm_call_count, spend.cost_eur) == (1, Decimal("0.05"))

    async def test_the_spend_is_recorded_before_its_proposal_is_stored(self) -> None:
        """A store that fails on the write after a billed call still leaves the bill on record:
        the money was spent whether or not the answer could be kept."""
        ledger = RecordingLedger()

        with pytest.raises(RuntimeError, match="the database went away"):
            await researching_into(ledger, StubResearcher(a_finding()), results=AStoreThatFails())

        assert [spend.cost_eur for spend in ledger.recorded] == [Decimal("0.05")]

    async def test_a_call_that_billed_nothing_is_not_recorded(self) -> None:
        """A model that could not be reached charged nothing, and a row of zeros is no spend."""
        ledger = RecordingLedger()
        unreached = Researched(
            match_result=MatchResult.UNKNOWN,
            reason="the model could not be reached: connection refused",
            citations=(),
        )

        await researching_into(ledger, StubResearcher(unreached))

        assert ledger.recorded == []

    async def test_a_call_counted_at_no_cost_is_still_recorded(self) -> None:
        """The edge: a reply reporting no usage prices at zero and still reached the model. The
        call is what the ledger counts, whatever it cost."""
        ledger = RecordingLedger()
        reached = Researched(
            match_result=MatchResult.UNKNOWN,
            reason="the model answered with no text at all",
            citations=(),
            cost_eur=Decimal(0),
            calls=1,
        )

        await researching_into(ledger, StubResearcher(reached))

        (spend,) = ledger.recorded
        assert (spend.llm_call_count, spend.cost_eur) == (1, Decimal(0))

    async def test_an_answer_refused_for_citing_nothing_is_still_recorded(self) -> None:
        """Refused, so nothing was stored -- and billed, so the ledger keeps it."""
        ledger = RecordingLedger()
        uncited = Researched(
            match_result=MatchResult.NOT_MATCHING,
            reason="I think",
            citations=(),
            cost_eur=Decimal("0.05"),
            calls=1,
        )

        outcome = await researching_into(ledger, StubResearcher(uncited))

        assert outcome.refusals
        assert [spend.cost_eur for spend in ledger.recorded] == [Decimal("0.05")]

    async def test_a_pass_halted_on_its_cap_has_recorded_every_call_it_paid_for(self) -> None:
        ledger = RecordingLedger()

        outcome = await researching_into(
            ledger,
            StubResearcher(a_finding(cost="1"), a_finding(cost="1")),
            candidates=(PORTUGAL, SPAIN),
            cap=Decimal(1),
        )

        assert outcome.halted_on_spend_cap is True
        assert [str(spend.candidate) for spend in ledger.recorded] == ["country.portugal"]


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

    def test_only_the_pairs_research_can_answer_are_estimated(self) -> None:
        """NEW-01. A gate research cannot answer costs nothing, and a researchable one is priced
        only for the candidates it concerns."""
        estimate = plan_research(
            researcher=StubResearcher(),
            rules=[A_DEFINITIONAL_GATE, THE_SWISS_QUOTA],
            candidates=[PORTUGAL, SWITZERLAND, SPAIN],
        )

        assert estimate.calls == 1
        assert estimate.cost_eur == Decimal("0.05")

    async def test_the_plan_and_the_pass_agree_about_what_research_can_answer(self) -> None:
        """The shared function holds for the new rule as it does for the level and the
        confirmed answers: one gate for nobody, one for one country, one for everyone."""
        researcher = StubResearcher(a_finding(), a_finding(), a_finding())
        rules = [A_DEFINITIONAL_GATE, THE_SWISS_QUOTA, THE_GATE]
        planned = plan_research(
            researcher=researcher, rules=rules, candidates=[PORTUGAL, SWITZERLAND]
        )

        outcome = await research_gates(
            researcher=researcher,
            rules=rules,
            candidates=[PORTUGAL, SWITZERLAND],
            citizenships=["country.romania"],
            results=RecordingResults(),
            spend_cap_eur=Decimal(10),
        )

        assert researcher.asked == [
            ("ch_eu_efta_quota", "country.switzerland"),
            ("uk_skilled_worker", "country.portugal"),
            ("uk_skilled_worker", "country.switzerland"),
        ]
        assert planned.calls == len(researcher.asked) == outcome.calls

    def test_the_pairs_come_back_in_the_order_they_will_be_asked(self) -> None:
        """Gate by gate, candidate by candidate -- so a pass halted on its cap has covered a
        prefix of the plan rather than an arbitrary subset of it."""
        pairs = gates_to_ask([THE_GATE], [PORTUGAL, SPAIN])

        assert [(str(rule.id), str(candidate.id)) for rule, candidate in pairs] == [
            ("uk_skilled_worker", "country.portugal"),
            ("uk_skilled_worker", "country.spain"),
        ]
