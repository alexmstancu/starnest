"""`CandidateStore` against PostgreSQL: the places under evaluation.

`arch.md` 6.3. The rows are catalog data, seeded by migration and read-only through this seam
(`arch.md` 1.2), which is why there is nothing here that writes one.

The level is denormalised onto the row as `(level, parent_level)` so the schema can check a
candidate against its parent with one composite key. The domain derives `parent_level` from the
`Level` instead of storing a second copy, so this mapper reads the level record rather than the
candidate's copy of it -- one of the two can be wrong, and it is not the one the level table
owns.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate, CandidateStore, Level
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresCandidateStore(CandidateStore):
    """The candidate roster, as the catalog holds it."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_candidates(self, *, level: str | None = None) -> tuple[Candidate, ...]:
        async with acquire(self._pool) as connection:
            levels = {row.id: row async for row in self._queries.select_levels(connection)}
            rows = [
                row
                async for row in self._queries.select_candidates(
                    connection, level=level, parent_candidate=None
                )
            ]
        return tuple(_candidate_from(row, levels) for row in rows)


def _candidate_from(row: Any, levels: dict[str, Any]) -> Candidate:
    """One `candidate` row as the domain object `candidates/` declared.

    `country_code` comes back as a plain string and is validated on the way into the model, so
    a code that somehow reached the column without matching alpha-2 is refused here with a
    sentence rather than travelling on as a two-letter-shaped string.
    """
    level = levels[row.level]
    return Candidate(
        id=row.id,
        name=row.name,
        level=Level(id=level.id, depth_order=level.depth_order, parent_level=level.parent_level),
        parent_candidate=row.parent_candidate,
        country_code=row.country_code,
    )
