"""Rank the candidates from what is actually stored. One reading, printed.

    make rank                          # the `minimal` set
    make rank SET=local_employment     # any other set, by its identifier

Every number it prints came from a stored value with a reference date. Countries with no
figures appear as `insufficient_data`, which is the honest outcome and the one worth seeing.

**It makes the same call `GET /v1/rankings` makes** (`api/rankings.py`): the score scale and the
coverage floor from the household's settings, the compound rules, and every gate's answers.
It used to hardcode a scale of 100 and pass none of the rest, so it applied no coverage floor --
and printed Liechtenstein as `matching` at 47% coverage when the product, with a floor of 60,
does not. A script that ranks differently from the product is a second opinion nobody asked for,
and it was the one being quoted.
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
        settings = await PostgresHouseholdStore(pool).get_settings()
        if settings.score_scale_max is None:
            # Refused rather than assumed, as the API refuses: a scale nobody chose would make
            # every score this prints a number on a scale nobody chose (`CLAUDE.md`).
            print("the score scale is not set, so nothing can be ranked: set it in Settings")
            return 1

        criteria = await PostgresCriteriaStore(pool).read_criteria_set(criteria_set, level=COUNTRY)
        candidates = await PostgresCandidateStore(pool).read_candidates(level=COUNTRY)
        values = PostgresValueStore(pool)
        active = {
            str(candidate.id): await values.read_active_values(candidates=[str(candidate.id)])
            for candidate in candidates
        }
        compound_rules = await PostgresCatalogStore(pool).read_compound_rules(level=COUNTRY)
        answers: dict[str, list] = {}
        for answer in await PostgresMatchRuleResultStore(pool).read_results(level=COUNTRY):
            answers.setdefault(str(answer.candidate), []).append(answer)

    results = rank_candidates(
        criteria=criteria,
        level=COUNTRY,
        values=active,
        score_scale_max=settings.score_scale_max,
        min_coverage=settings.min_coverage,
        compound_rules=compound_rules,
        gate_answers=answers,
    )

    floor = "none" if settings.min_coverage is None else f"{settings.min_coverage:.0f}%"
    print(f"scale 0-{settings.score_scale_max}, coverage floor {floor}\n")
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
