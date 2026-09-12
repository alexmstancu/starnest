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

from starnest.candidates import Candidate
from starnest.data import MatchResult, MatchRule, MatchRuleResult
from starnest.data_acquisition.estimate import NOTHING, Estimate
from starnest.data_acquisition.spend import CostMeter, refuse_unless_capped

_log = logging.getLogger("starnest.research")


class ProposalStore(Protocol):
    """Somewhere to put a proposal.

    **Declared here rather than imported**, because the full `MatchRuleResultStore` belongs to
    `criteria/`, which sits above this module in the layering (`arch.md` 6.2) -- and because one
    method is all this needs. A `Protocol`, so the concrete store satisfies it by shape: nothing
    in `storage/` has to know that this seam exists.
    """

    async def record(self, result: MatchRuleResult) -> None: ...


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
) -> ResearchOutcome:
    """Ask about every gate nobody has confirmed, and store what comes back as a proposal.

    **A confirmed answer is never re-asked.** Somebody looked, wrote it down, and paying a model
    to disagree with them is not research -- it is noise with a bill. A previous *proposal* is
    asked again, because nothing about it was settled.

    **The cap applies here as it does to a run** (`reqs.md` 6.3): refused before anything is
    asked when this would spend with no ceiling set, and it stops at the ceiling with everything
    already found kept.
    """
    refuse_unless_capped(
        costs_money=researcher.costs_money,
        cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
    )
    meter = CostMeter(cap_eur=spend_cap_eur)

    proposals: list[MatchRuleResult] = []
    refusals: list[str] = []
    for rule, candidate in gates_to_ask(rules, candidates, already_answered):
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

        if not found.citations:
            # The whole point of asking is the pages. An answer with none is an opinion, and an
            # opinion about a visa route is worth less than an open question.
            refusals.append(
                f"{rule.id} for {candidate.id}: the model cited nothing, so there is "
                "nothing to confirm"
            )
            continue

        proposal = MatchRuleResult(
            match_rule=rule.id,
            candidate=candidate.id,
            match_result=found.match_result,
            data_source="llm",
            retrieval_date=datetime.now(tz=UTC),
            reason=found.reason,
            citations=found.citations,
            is_proposal=True,
        )
        await results.record(proposal)
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


def gates_to_ask(
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
    already_answered: Sequence[MatchRuleResult] = (),
) -> tuple[tuple[MatchRule, Candidate], ...]:
    """Every (gate, candidate) a pass would ask about, in the order it would ask.

    **One function, because the pass and its estimate must not disagree.** An estimate that
    counted pairs the pass would skip -- a gate asked only at another level, or one somebody has
    already confirmed -- would promise work that never happens, which is worse than no estimate
    at all (`reqs.md` 6.3).

    A previous *proposal* is asked again, because nothing about it was settled; a confirmed
    answer never is, because paying a model to disagree with somebody who looked is noise with
    a bill.
    """
    confirmed = {
        (str(answer.match_rule), str(answer.candidate))
        for answer in already_answered
        if not answer.is_proposal
    }
    return tuple(
        (rule, candidate)
        for rule in rules
        for candidate in candidates
        if rule.applies_at(str(candidate.id.level_id))
        and (str(rule.id), str(candidate.id)) not in confirmed
    )


def plan_research(
    *,
    researcher: GateResearcher,
    rules: Sequence[MatchRule],
    candidates: Sequence[Candidate],
    already_answered: Sequence[MatchRuleResult] = (),
) -> Estimate:
    """What a research pass would cost, without asking anything.

    The count is exact -- one question per gate per candidate, which is how the researcher is
    built -- and the money is the researcher's own arithmetic, because it is the only thing that
    knows what it charges.
    """
    return researcher.estimate_for(len(gates_to_ask(rules, candidates, already_answered)))
