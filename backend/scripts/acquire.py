"""Fetch real figures from Eurostat and store them. One run, by hand.

Not the composition root -- `main.run()` is P3 and serves HTTP. This is the smallest thing that
turns an adapter into rows in the database, which is what `docs/mine2e.md` M2 needs and what
nothing before it could do.

    make acquire

Prints what came back and what did not. Both matter: a country with no figure is the honest
outcome the ranking has to show as coverage, and a failure is a thing to go and look at.
"""

import asyncio
from pathlib import Path

import httpx
from psycopg_pool import AsyncConnectionPool

from starnest.data_acquisition import acquire
from starnest.data_sources.eurostat import EurostatAdapter
from starnest.main import Environment
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresValueStore,
)

REPO = Path(__file__).resolve().parents[2]

COUNTRY = "country"


async def main() -> int:
    # `.env` lives at the repository root and is named relative to the working directory, so
    # it is pointed at explicitly rather than depending on where this was invoked from. The
    # file is never committed; `.env.example` documents its shape.
    environment = Environment(_env_file=REPO / ".env")  # type: ignore[call-arg]
    async with AsyncConnectionPool(environment.database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        catalog = PostgresCatalogStore(pool)
        adapter = EurostatAdapter(httpx.AsyncClient(timeout=60))

        attributes = await catalog.read_attributes(level=COUNTRY)
        candidates = await PostgresCandidateStore(pool).read_candidates(level=COUNTRY)
        print(f"{len(candidates)} candidates, {len(attributes)} attributes in the catalog")
        print(
            f"eurostat answers {len(adapter.attributes)} of them: {', '.join(adapter.attributes)}"
        )

        outcome = await acquire(
            adapter=adapter,
            attributes=attributes,
            candidates=candidates,
            values=PostgresValueStore(pool),
        )

    print(f"\nstored {len(outcome.stored)} values")
    for attribute in sorted({str(value.attribute) for value in outcome.stored}):
        found = [value for value in outcome.stored if str(value.attribute) == attribute]
        years = sorted({value.reference_period.end.year for value in found})
        print(f"  {attribute}: {len(found)} of {len(candidates)} countries, years {years}")
    if outcome.failures:
        print(f"\n{len(outcome.failures)} failures")
        for failure in outcome.failures:
            print(f"  {failure.attribute} {failure.candidate or ''}: {failure.reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
