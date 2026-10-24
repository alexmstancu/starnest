"""Rank the candidates from what is actually stored. One reading, printed.

    make rank                          # the `minimal` set
    make rank SET=local_employment     # any other set, by its identifier

Every number it prints came from a stored value with a reference date. Countries with no
figures appear as `insufficient_data`, which is the honest outcome and the one worth seeing.

**It is the ranking `GET /v1/rankings` serves** (`api/rankings.py`, D20): it calls
`the_ranking` itself rather than assembling the inputs again. It used to repeat the assembly, and
the copy drifted three ways -- a hardcoded scale of 100 and no coverage floor (it printed
Liechtenstein as `matching` at 47% coverage when the product, with a floor of 60, does not), then
a read per candidate and no home country. A script that ranks differently from the product is a
second opinion nobody asked for, and it was the one being quoted. What is left here is printing,
which `lines_of` does as a pure function so a unit test can read it.
"""

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path

from fastapi import HTTPException
from psycopg_pool import AsyncConnectionPool

from starnest.api.rankings import TheRanking, the_ranking
from starnest.data import ConfidenceLevel
from starnest.household import Settings
from starnest.main import Environment
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresHouseholdStore,
    PostgresMatchRuleResultStore,
    PostgresValueStore,
)

REPO = Path(__file__).resolve().parents[2]

COUNTRY = "country"
DEFAULT_SET = "minimal"


async def main(criteria_set: str) -> int:
    environment = Environment(_env_file=REPO / ".env")  # type: ignore[call-arg]
    async with AsyncConnectionPool(environment.database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        households = PostgresHouseholdStore(pool)
        try:
            ranking = await the_ranking(
                criteria_set,
                COUNTRY,
                PostgresCriteriaStore(pool),
                PostgresCandidateStore(pool),
                PostgresValueStore(pool),
                households,
                PostgresCatalogStore(pool),
                PostgresMatchRuleResultStore(pool),
            )
        except HTTPException as refusal:
            # Refused rather than assumed, as the API refuses: a scale nobody chose would make
            # every score this prints a number on a scale nobody chose (`CLAUDE.md`).
            print(refusal.detail["message"] if isinstance(refusal.detail, dict) else refusal.detail)
            return 1
        settings = await households.get_settings()
    for line in lines_of(ranking, settings):
        print(line)
    return 0


def lines_of(ranking: TheRanking, settings: Settings) -> Iterator[str]:
    """The ranking as `make rank` prints it, one line at a time."""
    floor = "none" if settings.min_coverage is None else f"{settings.min_coverage:.0f}%"
    yield f"scale 0-{ranking.score_scale_max}, coverage floor {floor}"
    yield ""
    # "of it, low": the share of the covered weight resting on a low-confidence figure -- an
    # estimate or a neighbour's figure standing in (reqs.md 5.7). Never discounted in the score,
    # so this column is the only place the difference shows.
    yield f"{'':4} {'candidate':28} {'score':>5} {'coverage':>9} {'of it, low':>11}  status"
    results = ranking.results
    for result in sorted(results, key=lambda r: (r.rank is None, r.rank or 0)):
        rank = f"{result.rank}." if result.rank else "  "
        score = result.score if result.score is not None else "--"
        split = result.coverage_by_confidence
        low = f"{split[ConfidenceLevel.LOW]:.0f}%" if split else "--"
        yield (
            f"{rank:>4} {result.candidate!s:28} {score:>5} "
            f"{result.coverage:>8.0f}% {low:>11}  {result.match_status}"
        )
    unscored = [r for r in results if r.score is None]
    if unscored:
        yield ""
        yield f"{len(unscored)} without a score:"
        for result in unscored:
            yield f"  {result.candidate}: {result.insufficient_reason}"


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SET)))
