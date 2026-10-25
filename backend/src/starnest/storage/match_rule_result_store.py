"""`MatchRuleResultStore` against PostgreSQL: each gate's answer, its pages and any override.

`arch.md` 6.3. The answer and its citations are written in one transaction: an answer whose
pages belong to the previous answer would show a reason next to someone else's evidence.

**Every answer is kept** (`reqs.md` Q237). Recording writes an immutable version with its pages
and points the live row at it, so a correction never destroys the answer it corrects, and a
saved refusal can pin the version it read.
"""

from datetime import date
from typing import Any

from psycopg_pool import AsyncConnectionPool

from starnest.candidates import CandidateId
from starnest.criteria import MatchRuleResultStore
from starnest.data import (
    DataSourceId,
    MatchResult,
    MatchRuleId,
    MatchRuleResult,
    ReferencePeriod,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresMatchRuleResultStore(MatchRuleResultStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_results(
        self,
        *,
        candidate: str | None = None,
        match_rule: str | None = None,
        level: str | None = None,
    ) -> tuple[MatchRuleResult, ...]:
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_match_rule_results(
                    connection, candidate=candidate, match_rule=match_rule, level=level
                )
            ]
        return tuple(_answer_from(row) for row in rows)

    async def record(self, result: MatchRuleResult) -> bool:
        """Store one answer with its pages -- unless it is a proposal and a person answered.

        The query declines to write a model's proposal over an answer a person recorded
        (NEW-02), and then the citations stay too: they are that answer's evidence, and
        replacing them would put the proposal's pages beside the person's reason. Which of the
        two happened is answered, so the endpoint can refuse what was declined (NEW-36) and a
        research pass can report it rather than list it (NEW-63).
        """
        period = result.reference_period
        answer = {
            "match_rule": str(result.match_rule),
            "candidate": str(result.candidate),
            "match_result": str(result.match_result),
            "reason": result.reason,
            "data_source": str(result.data_source),
            "reference_period_start": period.start if period else None,
            "reference_period_end": period.end if period else None,
            "retrieval_date": result.retrieval_date,
            "override_reason": result.override_reason,
            "override_date": result.override_date,
        }
        async with acquire(self._pool) as connection:
            try:
                # The version is written before the decline is known, so a declined proposal's
                # version is discarded with this savepoint: history for an answer that never
                # stood is not history.
                async with connection.transaction():
                    # The pair's live row first, so a re-check storing a proposal beside it and
                    # this replacing it take turns rather than interleave (D53).
                    await self._queries.lock_match_rule_result(
                        connection, match_rule=answer["match_rule"], candidate=answer["candidate"]
                    )
                    version = await self._queries.insert_match_rule_answer(
                        connection, beside_answer=None, assumed=_assumed(result), **answer
                    )
                    written = await self._queries.upsert_match_rule_result(
                        connection, answer=version.id, **answer
                    )
                    if not written:
                        raise _DeclinedError
                    await self._queries.insert_match_rule_answer_citations(
                        connection, answer=version.id, urls=list(result.citations)
                    )
                    await self._queries.replace_match_rule_result_citations(
                        connection,
                        match_rule=str(result.match_rule),
                        candidate=str(result.candidate),
                        urls=list(result.citations),
                    )
            except _DeclinedError:
                return False
        return True

    async def propose_beside(self, result: MatchRuleResult) -> bool:
        """Keep a re-check's finding as a version beside a person's answer, never over it (D53).

        The live row and its pages are not touched, so the person's answer keeps applying; the
        read serves the finding as that answer's pending proposal. Answers `False`, storing
        nothing, when the pair has no answer a person recorded -- there is then nothing to stand
        beside, and the finding belongs to an ordinary pass.
        """
        if not result.is_proposal:
            raise ValueError("only a proposal is kept beside an answer; record a person's answer")
        period = result.reference_period
        async with acquire(self._pool) as connection, connection.transaction():
            live = await self._queries.lock_match_rule_result(
                connection, match_rule=str(result.match_rule), candidate=str(result.candidate)
            )
            if live is None or not live.answered_by_a_person:
                return False
            version = await self._queries.insert_match_rule_answer(
                connection,
                match_rule=str(result.match_rule),
                candidate=str(result.candidate),
                match_result=str(result.match_result),
                reason=result.reason,
                data_source=str(result.data_source),
                reference_period_start=period.start if period else None,
                reference_period_end=period.end if period else None,
                retrieval_date=result.retrieval_date,
                override_reason=None,
                override_date=None,
                beside_answer=live.answer,
                assumed=_assumed(result),
            )
            await self._queries.insert_match_rule_answer_citations(
                connection, answer=version.id, urls=list(result.citations)
            )
        return True


def _assumed(result: MatchRuleResult) -> list[str] | None:
    """The citizenships the writer says this answer assumed, or None to copy the household's."""
    held = result.assumed_citizenships
    return None if held is None else [str(each) for each in held]


def _answer_from(row: Any) -> MatchRuleResult:
    return MatchRuleResult(
        id=row.answer,
        match_rule=MatchRuleId(row.match_rule),
        candidate=CandidateId(row.candidate),
        match_result=MatchResult(row.match_result),
        data_source=DataSourceId(row.data_source),
        retrieval_date=row.retrieval_date,
        reason=row.reason,
        # The query answers it from the source catalog: an answer a model gave is a
        # proposal until a human writes the same answer as `manual`.
        is_proposal=bool(row.is_proposal),
        reference_period=_period(row.reference_period_start, row.reference_period_end),
        citations=tuple(row.citations),
        override_reason=row.override_reason,
        override_date=row.override_date,
        recorded_at=row.recorded_at,
        pending_proposal=_pending_proposal_from(row),
        assumed_citizenships=(
            None
            if row.assumed_citizenships is None
            else tuple(CandidateId(held) for held in row.assumed_citizenships)
        ),
        needs_recheck=bool(row.needs_recheck),
    )


def _pending_proposal_from(row: Any) -> MatchRuleResult | None:
    """The re-check finding the query found beside a person's answer, when there is one."""
    if row.pending_answer is None:
        return None
    return MatchRuleResult(
        id=row.pending_answer,
        match_rule=MatchRuleId(row.match_rule),
        candidate=CandidateId(row.candidate),
        match_result=MatchResult(row.pending_match_result),
        data_source=DataSourceId(row.pending_data_source),
        retrieval_date=row.pending_retrieval_date,
        reason=row.pending_reason,
        is_proposal=True,
        reference_period=_period(
            row.pending_reference_period_start, row.pending_reference_period_end
        ),
        citations=tuple(row.pending_citations),
        recorded_at=row.pending_recorded_at,
    )


def _period(start: date | None, end: date | None) -> ReferencePeriod | None:
    return ReferencePeriod(start=start, end=end) if start is not None else None


class _DeclinedError(Exception):
    """A proposal the live answer declined: raised only to roll its version back."""
