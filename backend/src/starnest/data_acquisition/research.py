"""Researching a gate's answer, and why the answer is only ever a proposal.

`reqs.md` 6.10 use 3. A match rule is a judgement about the world -- does a visa route exist,
is the Swiss quota open, could two roles plausibly be found -- and no dataset publishes it. So
it is the one place where asking a model earns its keep: it can read the official pages and
report what they say, with the pages.

**And it is always confirmed by a human before it stands.** A proposal is stored with its
sources and rules nothing out (`evaluation/rules.py`); confirming it means writing the same
answer as `manual`, which replaces it. Excluding a country because a model said so, with nobody
having looked, is precisely the failure the inventory of permitted uses exists to prevent.

The port is declared here and implemented in `data_sources/llm/`, like every other source.
"""

import logging
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol

from starnest.candidates import Candidate, CandidateId
from starnest.data import DataSourceId, MatchResult, MatchRule, MatchRuleId, MatchRuleResult
from starnest.data_acquisition.estimate import NOTHING, Estimate
from starnest.data_acquisition.spend import CostMeter, refuse_unless_capped

_log = logging.getLogger("starnest.research")

_RESEARCHED_BY = DataSourceId("llm")
"""The source a researched answer, and the bill for it, are recorded under (`reqs.md` 6.10)."""


class ProposalStore(Protocol):
    """Somewhere to put a proposal.

    **Declared here rather than imported**, because the full `MatchRuleResultStore` belongs to
    `criteria/`, which sits above this module in the layering (`arch.md` 6.2) -- and because one
    method is all this needs. A `Protocol`, so the concrete store satisfies it by shape: nothing
    in `storage/` has to know that this seam exists.

    **`record` answers whether it stored the proposal, and the pass reads it** (NEW-63). A store
    declines a proposal a person got to first (NEW-02); the pass then leaves it out of the
    proposals it reports and names it among the refusals, because the call was still billed.
    """

    async def record(self, result: MatchRuleResult) -> bool: ...

    async def propose_beside(self, result: MatchRuleResult) -> bool:
        """Keep a re-check's proposal beside a person's answer, never over it (D53)."""
        ...


GatePair = tuple[str, str]
"""A gate and a candidate, by id: the unit a re-check names (D53)."""


class NothingRecordedToRecheckError(ValueError):
    """A re-check named a pair nobody has recorded an answer to.

    A re-check asks again about what a person decided, because a person asked (D53); a pair with
    no such answer belongs to an ordinary pass. Refused before anything is asked, naming each
    pair by the catalog's names, and listing them by id in `details` for a client to act on.
    """

    def __init__(self, message: str, *, pairs: Sequence[GatePair]) -> None:
        super().__init__(message)
        self.details = {
            "recheck": [{"match_rule": rule, "candidate": candidate} for rule, candidate in pairs]
        }


@dataclass(frozen=True)
class ResearchSpend:
    """What one research call billed: which gate, about which candidate, from which source."""

    match_rule: MatchRuleId
    candidate: CandidateId
    data_source: DataSourceId
    llm_call_count: int
    cost_eur: Decimal


class ResearchLedger(Protocol):
    """Somewhere to keep what each research call billed (BE-34).

    **Research writes gate answers, not figures, so it is not a run** (`reqs.md` 3.8), and its
    cost has no run row to accrue on. Without this the meter lived as long as the request: a
    response lost to a timeout, or a pass that died, took the only record of the spend with it.

    Declared here rather than imported for the reason `ProposalStore` is -- one method is all
    this needs, and the run store satisfies it by shape. Nothing here reads it back, and the API
    serves only its monthly sum, never its rows (`RunStore.read_holdings`, C04-N1).
    """

    async def record_research_spend(self, spend: ResearchSpend) -> None: ...


class NoResearcherConfiguredError(ValueError):
    """Nothing was configured to ask.

    A `ValueError`, as every refusal this API renders is: it is a statement about what was asked
    for rather than a fault in the code.

    An ordinary state rather than a fault: the MVP's figures come from structured sources and
    the LLM path is off until a key and its prices exist. The API answers 501, because an empty
    success would read as "no gate needed researching".
    """


@dataclass(frozen=True)
class Researched:
    """What the researcher found about one gate for one candidate."""

    match_result: MatchResult
    reason: str
    citations: tuple[str, ...]
    cost_eur: Decimal = Decimal(0)
    calls: int = 0


class GateResearcher(ABC):
    """Whatever can read the official pages and report what they say."""

    @property
    def costs_money(self) -> bool:
        """Whether asking it charges. True for a model; the cap question turns on it."""
        return True

    def estimate_for(self, calls: int) -> Estimate:
        """What `calls` questions would cost. Nothing unless the implementation prices itself."""
        return NOTHING

    @abstractmethod
    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        """One gate, one candidate, answered from pages it read.

        The citizenships are given because they decide the answer: free movement, the UK route
        and the Swiss quota all turn on which passports the household holds (`reqs.md` 7.3).
        """


@dataclass(frozen=True)
class ResearchOutcome:
    """What one pass of research produced."""

    proposals: tuple[MatchRuleResult, ...] = field(default=())
    refusals: tuple[str, ...] = field(default=())
    cost_eur: Decimal = Decimal(0)
    calls: int = 0
    halted_on_spend_cap: bool = False


async def research_gates(
    *,
    researcher: GateResearcher,
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
    citizenships: Sequence[str],
    results: ProposalStore,
    already_answered: Sequence[MatchRuleResult] = (),
    spend_cap_eur: Decimal | None = None,
    uncapped_is_accepted: bool = False,
    ledger: ResearchLedger | None = None,
    recheck: Sequence[GatePair] | None = None,
) -> ResearchOutcome:
    """Ask about every gate nobody has confirmed, and store what comes back as a proposal.

    **Only the pairs `gates_to_ask` names are asked**: a gate the catalog marks researchable,
    about a candidate it concerns (NEW-01). A pass with none to ask spends nothing, so it needs
    no cap either.

    **A confirmed answer is never re-asked** -- unless a person names it in `recheck` (D53).
    Somebody looked, wrote it down, and paying a model to disagree with them unasked is not
    research -- it is noise with a bill. A previous *proposal* is asked again, because nothing
    about it was settled. A re-check asks only the pairs it names, and keeps what it finds
    beside the person's answer, which goes on applying unchanged.

    **The cap applies here as it does to a run** (`reqs.md` 6.3): refused before anything is
    asked when this would spend with no ceiling set, and it stops at the ceiling with everything
    already found kept.

    **Every call that billed anything is ledgered the moment it returns** (BE-34): before its
    proposal is stored and before the next question is asked, so a pass that dies keeps the
    record of what it paid for. Given no ledger, the spend is reported and logged only.
    """
    to_ask = gates_to_ask(rules, candidates, already_answered, recheck=recheck)
    refuse_unless_capped(
        costs_money=researcher.costs_money and bool(to_ask),
        cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
    )
    meter = CostMeter(cap_eur=spend_cap_eur)

    proposals: list[MatchRuleResult] = []
    refusals: list[str] = []
    for rule, candidate in to_ask:
        if meter.is_exhausted:
            _log.warning("research halted on its spend cap: %s", meter.describe())
            return ResearchOutcome(
                proposals=tuple(proposals),
                refusals=tuple(refusals),
                cost_eur=meter.spent_eur,
                calls=meter.calls,
                halted_on_spend_cap=True,
            )

        found = await researcher.research(rule=rule, candidate=candidate, citizenships=citizenships)
        meter.spent(cost_eur=found.cost_eur, calls=found.calls)
        await _ledger_what_it_billed(ledger, rule, candidate, found)

        if not found.citations:
            # The whole point of asking is the pages. An answer with none is an opinion, and an
            # opinion about a visa route is worth less than an open question.
            #
            # **The researcher's own reason goes with it** (NEW-16). A model that could not be
            # reached, or billed for an empty answer, cited nothing as well, and a refusal saying
            # only that hid the one thing a person could act on.
            refusals.append(
                f"{rule.name} for {candidate.name}: the model cited nothing, so there is "
                f"nothing to confirm ({found.reason or 'no reason given'})"
            )
            continue

        proposal = _proposal_from(rule, candidate, found)
        if recheck is not None:
            # Beside the person's answer, never over it (D53). `gates_to_ask` saw one for every
            # pair, and nothing deletes it, so a decline here is a store that disagrees.
            if not await results.propose_beside(proposal):
                refusals.append(
                    f"{rule.name} for {candidate.name}: no answer a person recorded was found to "
                    "keep the proposal beside, so it was not stored"
                )
                continue
            proposals.append(proposal)
            continue
        if not await results.record(proposal):
            # A person answered this gate while the model was being asked, and a model never
            # replaces a person (NEW-02). Listing the proposal would show one that is not stored;
            # leaving it out would hide a call that was billed (NEW-63).
            refusals.append(
                f"{rule.name} for {candidate.name}: a person answered this gate while the pass "
                "ran, so the proposal was not stored"
            )
            continue
        proposals.append(proposal)
        _log.info(
            "proposed %s for %s: %s (%s)",
            rule.id,
            candidate.id,
            found.match_result,
            meter.describe(),
        )

    return ResearchOutcome(
        proposals=tuple(proposals),
        refusals=tuple(refusals),
        cost_eur=meter.spent_eur,
        calls=meter.calls,
    )


async def _ledger_what_it_billed(
    ledger: ResearchLedger | None, rule: MatchRule, candidate: Candidate, found: Researched
) -> None:
    """Keep what one call billed, when it billed anything and there is a ledger to keep it in.

    A call that never reached the provider cost nothing and counted no call, and a row of zeros
    would record a spend that never happened. A reply priced at zero still reached the model, so
    the call it counted is kept.
    """
    billed_anything = found.cost_eur > 0 or found.calls > 0
    if ledger is None or not billed_anything:
        return
    await ledger.record_research_spend(
        ResearchSpend(
            match_rule=rule.id,
            candidate=candidate.id,
            data_source=_RESEARCHED_BY,
            llm_call_count=found.calls,
            cost_eur=found.cost_eur,
        )
    )


def _proposal_from(rule: MatchRule, candidate: Candidate, found: Researched) -> MatchRuleResult:
    """What the researcher found, as an answer nobody has confirmed (`reqs.md` 6.10 use 3)."""
    return MatchRuleResult(
        match_rule=rule.id,
        candidate=candidate.id,
        match_result=found.match_result,
        data_source=_RESEARCHED_BY,
        retrieval_date=datetime.now(tz=UTC),
        reason=found.reason,
        citations=found.citations,
        is_proposal=True,
    )


def gates_to_ask(
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
    already_answered: Sequence[MatchRuleResult] = (),
    *,
    recheck: Sequence[GatePair] | None = None,
) -> tuple[tuple[MatchRule, Candidate], ...]:
    """Every (gate, candidate) a pass would ask about, in the order it would ask.

    **One function, because the pass and its estimate must not disagree.** An estimate that
    counted pairs the pass would skip -- a gate asked only at another level, or one somebody has
    already confirmed -- would promise work that never happens, which is worse than no estimate
    at all (`reqs.md` 6.3).

    **Only a gate the catalog marks researchable is asked, and only about the candidates it
    concerns** (`reqs.md` 7.3, NEW-01). The others are definitional or the household's own, and a
    model asked about them -- or about a country the gate is not about -- is billed for an
    answer nobody can use.

    A previous *proposal* is asked again, because nothing about it was settled; a confirmed
    answer never is, because paying a model to disagree with somebody who looked is noise with
    a bill -- **unless a person asks for it** (D53). Given `recheck`, those confirmed pairs are
    the whole scope, still narrowed by what research can answer; one nobody confirmed is refused
    before anything is asked.
    """
    confirmed = {
        (str(answer.match_rule), str(answer.candidate))
        for answer in already_answered
        if not answer.is_proposal
    }
    if recheck is not None:
        _refuse_a_recheck_of_nothing(recheck, confirmed, rules, candidates)
    rechecked = None if recheck is None else set(recheck)
    return tuple(
        (rule, candidate)
        for rule in rules
        if rule.researchable
        for candidate in candidates
        if rule.applies_at(str(candidate.id.level_id))
        and rule.concerns(str(candidate.id))
        and _is_asked((str(rule.id), str(candidate.id)), confirmed, rechecked)
    )


def _is_asked(pair: GatePair, confirmed: set[GatePair], rechecked: set[GatePair] | None) -> bool:
    """An ordinary pass asks what nobody confirmed; a re-check asks only what it names."""
    return pair not in confirmed if rechecked is None else pair in rechecked


def _refuse_a_recheck_of_nothing(
    recheck: Sequence[GatePair],
    confirmed: set[GatePair],
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
) -> None:
    unrecorded = [pair for pair in recheck if pair not in confirmed]
    if not unrecorded:
        return
    rule_names = {str(rule.id): rule.name for rule in rules}
    candidate_names = {str(candidate.id): candidate.name for candidate in candidates}
    named = "; ".join(
        f"{rule_names.get(rule, rule)} for {candidate_names.get(candidate, candidate)}"
        for rule, candidate in unrecorded
    )
    raise NothingRecordedToRecheckError(
        f"a re-check asks again only about an answer a person recorded, and nobody has recorded "
        f"one for {named}: nothing was asked",
        pairs=unrecorded,
    )


def plan_research(
    *,
    researcher: GateResearcher,
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
    already_answered: Sequence[MatchRuleResult] = (),
    recheck: Sequence[GatePair] | None = None,
) -> Estimate:
    """What a research pass would cost, without asking anything.

    The count is exact -- one question per pair `gates_to_ask` names, which is how the
    researcher is built -- and the money is the researcher's own arithmetic, because it is the
    only thing that knows what it charges.
    """
    return researcher.estimate_for(
        len(gates_to_ask(rules, candidates, already_answered, recheck=recheck))
    )
