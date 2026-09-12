"""`MatchRuleResultStore` against PostgreSQL: each gate's answer, its pages and any override.

`arch.md` 6.3. The answer and its citations are written in one transaction: an answer whose
pages belong to the previous answer would show a reason next to someone else's evidence.
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

    async def record(self, result: MatchRuleResult) -> None:
        period = result.reference_period
        async with acquire(self._pool) as connection:
            await self._queries.upsert_match_rule_result(
                connection,
                match_rule=str(result.match_rule),
                candidate=str(result.candidate),
                match_result=str(result.match_result),
                reason=result.reason,
                data_source=str(result.data_source),
                reference_period_start=period.start if period else None,
                reference_period_end=period.end if period else None,
                retrieval_date=result.retrieval_date,
                override_reason=result.override_reason,
                override_date=result.override_date,
            )
            await self._queries.replace_match_rule_result_citations(
                connection,
                match_rule=str(result.match_rule),
                candidate=str(result.candidate),
                urls=list(result.citations),
            )
