"""`MatchRuleResultStore` against PostgreSQL: each gate's answer, its pages and any override.

`arch.md` 6.3. The answer and its citations are written in one transaction: an answer whose
pages belong to the previous answer would show a reason next to someone else's evidence.

**Every answer is kept** (`reqs.md` Q237). Recording writes an immutable version with its pages
and points the live row at it, so a correction never destroys the answer it corrects, and a
saved refusal can pin the version it read.
"""

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
        return tuple(
            MatchRuleResult(
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
                reference_period=(
                    ReferencePeriod(start=row.reference_period_start, end=row.reference_period_end)
                    if row.reference_period_start is not None
                    else None
                ),
                citations=tuple(row.citations),
                override_reason=row.override_reason,
                override_date=row.override_date,
            )
            for row in rows
        )

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
                    version = await self._queries.insert_match_rule_answer(connection, **answer)
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


class _DeclinedError(Exception):
    """A proposal the live answer declined: raised only to roll its version back."""
