"""The named gates, and each candidate's answer to them (`reqs.md` 3.7).

A gate is a judgement, not a measurement -- the UK Skilled Worker route, the Swiss EU/EFTA quota,
a candidate ruled out by hand -- so its answers are recorded by a person (or, at the city level,
by the LLM path) and carry the same two dates and the same obligation to cite as a value does.
**An override is audited**: a reason and the moment it was given, set by the server, travelling
with the answer everywhere it is shown.

Whether an answer affects a ranking is the criteria set's choice and is P5's work; these
endpoints record and read the answers.
"""

from datetime import UTC, date, datetime
from typing import ClassVar

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.api.bodies import NullRefusingBody
from starnest.api.dependencies import (
    Candidates,
    Catalog,
    Households,
    MatchRuleResults,
    Researcher,
    Runs,
)
from starnest.api.errors import absent, built_from_the_request, unknown_scope_refusal
from starnest.candidates import CandidateId, UnknownCandidateError
from starnest.data import (
    MANUAL,
    AnswerRecordedByAPersonError,
    DataSourceId,
    MalformedMatchRuleResultError,
    MatchResult,
    MatchRuleId,
    MatchRuleResult,
    ReferencePeriod,
    UnknownDataSourceError,
    UnknownMatchRuleError,
    WebAddress,
)
from starnest.data_acquisition import (
    NoResearcherConfiguredError,
    pairs_cleared_by_citizenship,
    plan_research,
    research_gates,
)
from starnest.evaluation import describe_compound_rule
from starnest.evaluation.wording import names_in
from starnest.household import HouseholdNotConfiguredError

router = APIRouter(tags=["rules"])


class MatchRuleBody(BaseModel):
    id: str
    name: str
    level: str | None = None
    description: str
    """When a candidate matches the gate, in words: catalog text (`reqs.md` 7.3, D57)."""
    cleared_by: tuple[str, ...] = ()
    """The citizenships that clear the gate wherever it asks (`reqs.md` 7.3, Q239)."""
    decided_by_citizenship: bool = False
    """Whether the household's citizenships decide it outright, with no recorded answer."""


class MatchRulesBody(BaseModel):
    items: tuple[MatchRuleBody, ...]


class ReferencePeriodBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date
    end: date


class MatchRuleResultInputBody(NullRefusingBody):
    """Left out, the retrieval date is now; the design gives a null one no meaning (NEW-61)."""

    not_nullable: ClassVar[frozenset[str]] = frozenset({"retrieval_date"})

    match_result: MatchResult
    reason: str | None = None
    data_source: str = str(MANUAL)
    reference_period: ReferencePeriodBody | None = None
    retrieval_date: datetime | None = None
    # An override is a reason and a date together, and an empty reason is neither (BE-21).
    override_reason: str | None = Field(default=None, min_length=1)
    citations: tuple[WebAddress, ...] = ()


class PendingProposalBody(BaseModel):
    """What a re-check found beside a person's answer: a proposal, so it rules nothing out."""

    match_result: str
    reason: str | None = None
    data_source: str
    reference_period: ReferencePeriodBody | None = None
    retrieval_date: datetime
    recorded_at: datetime
    citations: tuple[str, ...] = ()


class MatchRuleResultBody(BaseModel):
    match_rule: str
    candidate: str
    match_result: str
    reason: str | None = None
    data_source: str
    reference_period: ReferencePeriodBody | None = None
    retrieval_date: datetime
    override_reason: str | None = None
    override_date: datetime | None = None
    citations: tuple[str, ...] = ()
    is_proposal: bool = False
    # The dates an answer's age and ended period are read from in the browser (D54); the server
    # computes neither, and an ended period expires nothing.
    recorded_at: datetime | None = None
    pending_proposal: PendingProposalBody | None = None
    # What the answer assumed, and whether the household has changed since (Q239). A flag for a
    # person to act on: the answer applies until a person records again.
    assumed_citizenships: tuple[str, ...] | None = None
    needs_recheck: bool = False


class GatePairBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_rule: str
    candidate: str


class ResearchRequestBody(BaseModel):
    """Which gates to research, and whether an uncapped spend is accepted (`reqs.md` 6.3).

    A misspelled `match_rules` used to fall to null, which is every gate at the level -- a
    paid pass over all of them when one was named (BE-23).
    """

    model_config = ConfigDict(extra="forbid")

    level: str
    match_rules: tuple[str, ...] | None = None
    candidates: tuple[str, ...] | None = None
    recheck: tuple[GatePairBody, ...] | None = Field(default=None, min_length=1)
    accept_uncapped_spend: bool = False

    @model_validator(mode="after")
    def _a_recheck_is_its_own_scope(self) -> "ResearchRequestBody":
        """A re-check names its pairs, so a gate or candidate list beside it would narrow it --
        and a narrowed paid scope is the drop BE-24 refuses rather than conceals (D53)."""
        if self.recheck is not None and (
            self.match_rules is not None or self.candidates is not None
        ):
            raise ValueError(
                "a re-check names its answers, so match_rules and candidates are left out"
            )
        return self

    @property
    def rechecked_pairs(self) -> list[tuple[str, str]] | None:
        if self.recheck is None:
            return None
        return [(pair.match_rule, pair.candidate) for pair in self.recheck]


async def _research_targets(
    body: ResearchRequestBody, catalog: Catalog, candidates: Candidates
) -> tuple[list, list]:
    """The gates and candidates a research scope names, after refusing any it does not (BE-24).

    Shared by the estimate and the pass so the bill and the spend read the scope the same way --
    and so a misspelled gate or an out-of-level candidate is refused rather than dropped from a
    paid request, which used to spend on the rest while concealing the drop. **The level is one
    of those ids** (NEW-60): a level nothing is catalogued at estimated and researched nothing
    with a 200, where a run's scope is refused (NEW-40).
    """
    levels = await catalog.read_levels()
    rules = await catalog.read_match_rules()
    roster = await candidates.read_candidates(level=body.level)
    unknown_levels = [] if body.level in levels else [body.level]
    rechecked = body.rechecked_pairs or []
    unknown_rules = absent(
        _distinct([*(body.match_rules or ()), *(rule for rule, _ in rechecked)]),
        {str(rule.id) for rule in rules},
    )
    unknown_candidates = absent(
        _distinct([*(body.candidates or ()), *(candidate for _, candidate in rechecked)]),
        {str(candidate.id) for candidate in roster},
    )
    if unknown_levels or unknown_rules or unknown_candidates:
        raise unknown_scope_refusal(
            body.level,
            unknown_levels=unknown_levels,
            unknown_match_rules=unknown_rules,
            unknown_candidates=unknown_candidates,
        )
    wanted_rules = [
        rule for rule in rules if body.match_rules is None or str(rule.id) in set(body.match_rules)
    ]
    chosen = [
        candidate
        for candidate in roster
        if body.candidates is None or str(candidate.id) in set(body.candidates)
    ]
    return wanted_rules, chosen


def _distinct(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(ids))


async def _refuse_while_the_llm_source_is_off(catalog: Catalog) -> None:
    """**A source the household switched off is not asked** (`reqs.md` 2, Q232, BE-15).

    Gate research is the paid LLM path, so disabling the `llm` source must stop it spending --
    the pass used to check only that a model was configured, never the toggle. Shared with the
    estimate, which otherwise priced a pass that the pass then refused (NEW-03).
    """
    if any(
        str(source.id) == "llm" and not source.is_enabled
        for source in await catalog.read_data_sources()
    ):
        raise NoResearcherConfiguredError(
            "the llm source is switched off, so no gate can be researched -- it is the paid LLM "
            "path, and a switched-off source is not asked. Switch it on in "
            "Configure to research gates."
        )


class ResearchPlanBody(BaseModel):
    """What a research pass would ask and what it would cost (`reqs.md` 6.3)."""

    gates_total: int
    # Equal to `gates_total` while one gate is one question, which is how `LlmGateResearcher`
    # asks. Both are reported because they answer different questions -- how much work, and how
    # many billed calls -- and a researcher that batched gates would separate them.
    llm_call_count: int
    estimated_cost_eur: float
    estimate_basis: str | None = None
    # Pairs left out because the household's citizenships clear them (Q239): never asked, never
    # billed, and counted so the plan says why it asks fewer than the gates concern.
    cleared_by_citizenship: int = 0


class ResearchOutcomeBody(BaseModel):
    proposals: tuple[MatchRuleResultBody, ...]
    refusals: tuple[str, ...] = ()
    cost_eur: float
    calls: int
    halted_on_spend_cap: bool


class MatchRuleResultsBody(BaseModel):
    items: tuple[MatchRuleResultBody, ...]


class CompoundRuleInputBody(BaseModel):
    input_order: int
    attribute: str | None = None
    household_field: str | None = None


class CompoundRuleConditionBody(BaseModel):
    ordinal: int
    attribute: str
    threshold_min: float | None = None
    threshold_max: float | None = None


class CompoundRuleBody(BaseModel):
    """A rule over more than one figure. **A null threshold is one nobody has chosen yet**
    (`reqs.md` 7.4): an undecided rule is stored, displayed and never fired."""

    id: str
    name: str
    description: str
    """What the rule tests, written from its conditions when read (PL-155): never an id."""
    level: str | None = None
    shape: str
    outcome: str
    threshold_min: float | None = None
    threshold_max: float | None = None
    inputs: tuple[CompoundRuleInputBody, ...] = ()
    conditions: tuple[CompoundRuleConditionBody, ...] = ()


class CompoundRulesBody(BaseModel):
    items: tuple[CompoundRuleBody, ...]


@router.get("/compound-rules", operation_id="listCompoundRules", response_model=CompoundRulesBody)
async def list_compound_rules(catalog: Catalog, level: str | None = None) -> CompoundRulesBody:
    """The rules that read more than one figure at once (`reqs.md` 3.7a).

    Both the MVP ships are **undecided** -- every threshold in `reqs.md` 7.4 is TBD -- so they
    are listed with null bounds and fire nothing. That is the shipping state, not an omission:
    a rule fired on an invented number is the fabricated judgement this application prevents.
    """
    names = names_in(await catalog.read_attributes(level=level), ())
    return CompoundRulesBody(
        items=tuple(
            CompoundRuleBody(
                id=str(rule.id),
                name=rule.name,
                description=describe_compound_rule(rule, names),
                level=None if rule.level is None else str(rule.level),
                shape=str(rule.shape),
                outcome=str(rule.outcome),
                threshold_min=rule.threshold_min,
                threshold_max=rule.threshold_max,
                inputs=tuple(
                    CompoundRuleInputBody(
                        input_order=read.input_order,
                        attribute=None if read.attribute is None else str(read.attribute),
                        household_field=(
                            None if read.household_field is None else str(read.household_field)
                        ),
                    )
                    for read in rule.inputs
                ),
                conditions=tuple(
                    CompoundRuleConditionBody(
                        ordinal=condition.ordinal,
                        attribute=str(condition.attribute),
                        threshold_min=condition.threshold_min,
                        threshold_max=condition.threshold_max,
                    )
                    for condition in rule.conditions
                ),
            )
            for rule in await catalog.read_compound_rules(level=level)
        )
    )


@router.get("/match-rules", operation_id="listMatchRules", response_model=MatchRulesBody)
async def list_match_rules(catalog: Catalog, level: str | None = None) -> MatchRulesBody:
    """The gates, or those asked at one level. A gate with no level is asked at every level."""
    return MatchRulesBody(
        items=tuple(
            MatchRuleBody(
                id=str(rule.id),
                name=rule.name,
                level=rule.level,
                description=rule.description,
                cleared_by=tuple(str(citizenship) for citizenship in rule.cleared_by),
                decided_by_citizenship=rule.decided_by_citizenship,
            )
            for rule in await catalog.read_match_rules(level=level)
        )
    )


@router.get(
    "/match-rule-results", operation_id="listMatchRuleResults", response_model=MatchRuleResultsBody
)
async def list_match_rule_results(
    results: MatchRuleResults, candidate: str | None = None, match_rule: str | None = None
) -> MatchRuleResultsBody:
    return MatchRuleResultsBody(
        items=tuple(
            _result_body(result)
            for result in await results.read_results(candidate=candidate, match_rule=match_rule)
        )
    )


@router.post(
    "/match-rule-research/plan",
    operation_id="planMatchRuleResearch",
    response_model=ResearchPlanBody,
)
async def plan_match_rule_research(
    body: ResearchRequestBody,
    researcher: Researcher,
    results: MatchRuleResults,
    catalog: Catalog,
    candidates: Candidates,
    households: Households,
) -> ResearchPlanBody:
    """What researching the gates would cost, without asking anything.

    **The estimate before the spend** (`reqs.md` 6.3, Q22): research is the most expensive thing
    this application does -- one call per gate per candidate it concerns -- and the household
    should see the bill before agreeing to it rather than after. It counts the same pairs the pass
    would ask about, through the same function (`gates_to_ask`), so the two cannot disagree: a
    gate research cannot answer, a candidate the gate is not about, a gate asked only at another
    level, or one somebody has already confirmed, is in neither (NEW-01).

    Nothing is stored and nothing is charged. With no model configured this is a 501, as the
    pass itself is: an estimate of zero would read as "this would cost nothing". So is a
    switched-off `llm` source, or the estimate would price a pass that is then refused (NEW-03).
    """
    if researcher is None:
        raise NoResearcherConfiguredError(
            "no model is configured, so there is nothing to estimate: set ANTHROPIC_API_KEY and "
            "the LLM prices"
        )
    await _refuse_while_the_llm_source_is_off(catalog)

    wanted_rules, roster = await _research_targets(body, catalog, candidates)
    answered = await results.read_results()
    # With no household recorded nothing is cleared, and the pass itself refuses; the estimate
    # still prices what it would ask.
    try:
        citizenships = [str(held) for held in (await households.get_household()).citizenships]
    except HouseholdNotConfiguredError:
        citizenships = []
    estimate = plan_research(
        researcher=researcher,
        rules=wanted_rules,
        candidates=roster,
        already_answered=answered,
        recheck=body.rechecked_pairs,
        citizenships=citizenships,
    )
    return ResearchPlanBody(
        gates_total=estimate.calls,
        llm_call_count=estimate.calls,
        estimated_cost_eur=float(estimate.cost_eur),
        estimate_basis=estimate.basis or None,
        cleared_by_citizenship=pairs_cleared_by_citizenship(
            wanted_rules,
            roster,
            answered,
            recheck=body.rechecked_pairs,
            citizenships=citizenships,
        ),
    )


@router.post(
    "/match-rule-research", operation_id="researchMatchRules", response_model=ResearchOutcomeBody
)
async def research_match_rules(
    body: ResearchRequestBody,
    researcher: Researcher,
    results: MatchRuleResults,
    catalog: Catalog,
    candidates: Candidates,
    households: Households,
    runs: Runs,
) -> ResearchOutcomeBody:
    """Ask a model to read the official pages about every gate nobody has confirmed.

    `reqs.md` 6.10 use 3. **What comes back is a proposal**: stored with its sources, displayed,
    and ruling nothing out until a human writes the same answer through `putMatchRuleResult`.

    **Only a gate the catalog marks researchable is asked, and only about the candidates it
    concerns** (`reqs.md` 7.3, NEW-01). A scope naming a gate research cannot answer asks nothing
    and costs nothing, and is answered rather than refused: the page asks one gate per request.

    **It costs money**, so the cap applies as it does to a run: refused with 409 when none is set
    unless this request accepts an uncapped one, and it halts at the cap keeping every proposal
    already found. **Every call that billed anything is ledgered as it returns** (BE-34), so the
    spend is on record even when this response never arrives. With no model configured there is
    nothing to ask, which is a 501 rather than an empty success -- an empty success would read as
    "no gate needed researching".

    **A re-check** (`recheck`, D53) asks again about answers a person recorded, and only those;
    what it finds is kept beside each answer as its pending proposal, never over it.
    """
    if researcher is None:
        raise NoResearcherConfiguredError(
            "no model is configured, so no gate can be researched: set ANTHROPIC_API_KEY and "
            "the three LLM prices"
        )
    await _refuse_while_the_llm_source_is_off(catalog)

    wanted_rules, roster = await _research_targets(body, catalog, candidates)
    household = await households.get_household()

    outcome = await research_gates(
        researcher=researcher,
        rules=wanted_rules,
        candidates=roster,
        citizenships=[str(citizenship) for citizenship in household.citizenships],
        results=results,
        already_answered=await results.read_results(),
        spend_cap_eur=(await households.get_settings()).run_spend_cap_eur,
        uncapped_is_accepted=body.accept_uncapped_spend,
        ledger=runs,
        recheck=body.rechecked_pairs,
    )
    return ResearchOutcomeBody(
        proposals=tuple(_result_body(proposal) for proposal in outcome.proposals),
        refusals=outcome.refusals,
        cost_eur=float(outcome.cost_eur),
        calls=outcome.calls,
        halted_on_spend_cap=outcome.halted_on_spend_cap,
    )


@router.put(
    "/match-rule-results/{match_rule_id}/{candidate_id}",
    operation_id="putMatchRuleResult",
    response_model=MatchRuleResultBody,
)
async def put_match_rule_result(
    match_rule_id: str,
    candidate_id: str,
    body: MatchRuleResultInputBody,
    results: MatchRuleResults,
    catalog: Catalog,
    candidates: Candidates,
) -> MatchRuleResultBody:
    """Record or override one gate's answer. Also how a candidate is ruled out by hand: the
    `not_manually_excluded` gate, answered `not_matching`, with a reason (`reqs.md` Q152).

    **A model's answer over one a person recorded is refused with 409** (NEW-36). The store
    declines it -- a model proposes and a person decides (`reqs.md` 6.10 use 3) -- and this used
    to answer 200 with the person's answer, a success for a write that never happened.
    """
    rule = next((r for r in await catalog.read_match_rules() if str(r.id) == match_rule_id), None)
    if rule is None:
        raise UnknownMatchRuleError(f"there is no gate {match_rule_id!r}")
    candidate = next(
        (c for c in await candidates.read_candidates() if str(c.id) == candidate_id), None
    )
    if candidate is None:
        raise UnknownCandidateError(f"there is no candidate {candidate_id!r}")
    the_pair = {"match_rule": match_rule_id, "candidate": candidate_id}
    if rule.level is not None and str(candidate.level.id) != str(rule.level):
        raise MalformedMatchRuleResultError(
            f"{rule.name} is asked of {rule.level} candidates, and {candidate.name} is not one",
            details=the_pair,
        )
    source = next(
        (s for s in await catalog.read_data_sources() if str(s.id) == body.data_source), None
    )
    if source is None:
        raise UnknownDataSourceError(f"there is no data source {body.data_source!r}")

    now = datetime.now(UTC)
    with built_from_the_request():
        answer = MatchRuleResult(
            match_rule=MatchRuleId(match_rule_id),
            candidate=CandidateId(candidate_id),
            match_result=body.match_result,
            data_source=DataSourceId(body.data_source),
            retrieval_date=body.retrieval_date or now,
            reason=body.reason,
            reference_period=(
                ReferencePeriod(start=body.reference_period.start, end=body.reference_period.end)
                if body.reference_period
                else None
            ),
            citations=body.citations,
            # The moment is the server's, never the client's: an audit trail whose dates the
            # audited party supplies is not one.
            override_reason=body.override_reason,
            override_date=now if body.override_reason else None,
        )
    if not await results.record(answer):
        raise AnswerRecordedByAPersonError(
            f"a person has answered {rule.name} for {candidate.name}, and an answer from "
            f"{source.name}, a model, never replaces one: nothing was stored. Record it by hand "
            "to replace the person's answer.",
            details=the_pair,
        )
    (stored,) = await results.read_results(candidate=candidate_id, match_rule=match_rule_id)
    return _result_body(stored)


def _result_body(result: MatchRuleResult) -> MatchRuleResultBody:
    period = result.reference_period
    return MatchRuleResultBody(
        match_rule=str(result.match_rule),
        candidate=str(result.candidate),
        match_result=str(result.match_result),
        reason=result.reason,
        data_source=str(result.data_source),
        reference_period=ReferencePeriodBody(start=period.start, end=period.end)
        if period
        else None,
        retrieval_date=result.retrieval_date,
        override_reason=result.override_reason,
        override_date=result.override_date,
        citations=result.citations,
        # A model answered and nobody has confirmed it (`reqs.md` 6.10 use 3). Shown, so the
        # screen can mark it as something to check rather than something decided.
        is_proposal=result.is_proposal,
        recorded_at=result.recorded_at,
        pending_proposal=_pending_body(result.pending_proposal),
        assumed_citizenships=(
            None
            if result.assumed_citizenships is None
            else tuple(str(held) for held in result.assumed_citizenships)
        ),
        needs_recheck=result.needs_recheck,
    )


def _pending_body(pending: MatchRuleResult | None) -> PendingProposalBody | None:
    if pending is None or pending.recorded_at is None:
        return None
    period = pending.reference_period
    return PendingProposalBody(
        match_result=str(pending.match_result),
        reason=pending.reason,
        data_source=str(pending.data_source),
        reference_period=ReferencePeriodBody(start=period.start, end=period.end)
        if period
        else None,
        retrieval_date=pending.retrieval_date,
        recorded_at=pending.recorded_at,
        citations=pending.citations,
    )
