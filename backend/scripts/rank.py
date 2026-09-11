"""Rank the candidates from what is actually stored. One reading, printed.

Not the API -- `GET /v1/rankings` is M3. This exists to prove the two halves meet: the values
`make acquire` fetched, read through the active-value rule, scored by `evaluation/`.

    make rank                          # the `minimal` set
    make rank SET=local_employment     # any other set, by its identifier

Every number it prints came from a stored value with a reference date. Countries with no
figures appear as `insufficient_data`, which is the honest outcome and the one worth seeing.
"""

import asyncio
import sys
from pathlib import Path

from psycopg_pool import AsyncConnectionPool

from starnest.data import ConfidenceLevel
from starnest.evaluation import rank_candidates
from starnest.main import Environment
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCriteriaStore,
    PostgresValueStore,
)

REPO = Path(__file__).resolve().parents[2]

COUNTRY = "country"
DEFAULT_SET = "minimal"
SCALE = 100


async def main(criteria_set: str) -> int:
    environment = Environment(_env_file=REPO / ".env")  # type: ignore[call-arg]
    async with AsyncConnectionPool(environment.database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(criteria_set, level=COUNTRY)
        candidates = await PostgresCandidateStore(pool).read_candidates(level=COUNTRY)
        values = PostgresValueStore(pool)
        active = {
            str(candidate.id): await values.read_active_values(candidates=[str(candidate.id)])
            for candidate in candidates
        }

    results = rank_candidates(
        criteria=criteria, level=COUNTRY, values=active, score_scale_max=SCALE
    )

    # "of it, low": the share of the covered weight resting on a low-confidence figure -- an
    # estimate or a neighbour's figure standing in (reqs.md 5.7). Never discounted in the score,
    # so this column is the only place the difference shows.
    print(f"{'':4} {'candidate':28} {'score':>5} {'coverage':>9} {'of it, low':>11}  status")
    for result in sorted(results, key=lambda r: (r.rank is None, r.rank or 0)):
        rank = f"{result.rank}." if result.rank else "  "
        score = result.score if result.score is not None else "--"
        split = result.coverage_by_confidence
        low = f"{split[ConfidenceLevel.LOW]:.0f}%" if split else "--"
        print(
            f"{rank:>4} {result.candidate!s:28} {score:>5} "
            f"{result.coverage:>8.0f}% {low:>11}  {result.match_status}"
        )
    unscored = [r for r in results if r.score is None]
    if unscored:
        print(f"\n{len(unscored)} without a score:")
        for result in unscored:
            print(f"  {result.candidate}: {result.insufficient_reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SET)))
