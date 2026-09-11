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

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.dependencies import Candidates, Catalog, MatchRuleResults
from starnest.candidates import CandidateId, UnknownCandidateError
from starnest.data import (
    MANUAL,
    DataSourceId,
    MalformedMatchRuleResultError,
    MatchResult,
    MatchRuleId,
    MatchRuleResult,
    ReferencePeriod,
    UnknownDataSourceError,
    UnknownMatchRuleError,
)

router = APIRouter(tags=["rules"])


class MatchRuleBody(BaseModel):
    id: str
    name: str
    level: str | None = None


class MatchRulesBody(BaseModel):
    items: tuple[MatchRuleBody, ...]


class ReferencePeriodBody(BaseModel):
    start: date
    end: date


class MatchRuleResultInputBody(BaseModel):
    match_result: MatchResult
    reason: str | None = None
    data_source: str = str(MANUAL)
    reference_period: ReferencePeriodBody | None = None
    retrieval_date: datetime | None = None
    override_reason: str | None = None
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


class MatchRuleResultsBody(BaseModel):
    items: tuple[MatchRuleResultBody, ...]


@router.get("/match-rules", operation_id="listMatchRules", response_model=MatchRulesBody)
async def list_match_rules(catalog: Catalog, level: str | None = None) -> MatchRulesBody:
    """The gates, or those asked at one level. A gate with no level is asked at every level."""
    return MatchRulesBody(
        items=tuple(
            MatchRuleBody(id=str(rule.id), name=rule.name, level=rule.level)
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
    `not_manually_excluded` gate, answered `not_matching`, with a reason (`reqs.md` Q152)."""
    rule = next((r for r in await catalog.read_match_rules() if str(r.id) == match_rule_id), None)
    if rule is None:
        raise UnknownMatchRuleError(f"there is no gate {match_rule_id!r}")
    candidate = next(
        (c for c in await candidates.read_candidates() if str(c.id) == candidate_id), None
    )
    if candidate is None:
        raise UnknownCandidateError(f"there is no candidate {candidate_id!r}")
    if rule.level is not None and str(candidate.level.id) != str(rule.level):
        raise MalformedMatchRuleResultError(
            f"{rule.id} is asked of {rule.level} candidates, and {candidate_id} is not one"
        )
    if body.data_source not in {str(source.id) for source in await catalog.read_data_sources()}:
        raise UnknownDataSourceError(f"there is no data source {body.data_source!r}")

    now = datetime.now(UTC)
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
    await results.record(answer)
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
    )
