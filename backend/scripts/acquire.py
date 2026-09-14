"""Fetch real figures from every source we have and store them. One run, by hand.

Not the composition root -- `main.run()` serves HTTP and does this through the API. This is the
smallest thing that turns an adapter into rows in the database, and it stays because a source
being wired up is worth proving without a container in the way.

    make acquire

Prints what came back and what did not, per source. Both matter: a country with no figure is the
honest outcome the ranking has to show as coverage, and a failure is a thing to go and look at.
"""

import asyncio
from pathlib import Path

from psycopg_pool import AsyncConnectionPool

from starnest.data_acquisition import STAND_IN, SourceAdapter, acquire, stand_in
from starnest.main import Environment, _the_sources
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresValueStore,
)

REPO = Path(__file__).resolve().parents[2]

COUNTRY = "country"


def every_adapter(
    catalog: PostgresCatalogStore, environment: Environment
) -> tuple[SourceAdapter, ...]:
    """The free sources the application wires in, taken from the composition root itself.

    **This used to be a second copy of the list, and the copy drifted.** It was duplicated to
    avoid importing `main` -- while this script already imported `Environment` from it -- and
    when the transcribed tables joined the registry (Q230) they joined only the real one, so
    `make acquire` reported success and stored nothing for three attributes. Same failure as
    P5, where a run asked one source while its plan counted six.

    **Free sources only, always.** A sweep over a level must never spend: the API refuses a paid
    run without a cap, and this script checks no cap at all, so anything that charges is left
    out here rather than trusted to behave.
    """
    return tuple(
        adapter for adapter in _the_sources(catalog, environment) if not adapter.costs_money
    )


async def main() -> int:
    # `.env` lives at the repository root and is named relative to the working directory, so
    # it is pointed at explicitly rather than depending on where this was invoked from. The
    # file is never committed; `.env.example` documents its shape.
    environment = Environment(_env_file=REPO / ".env")  # type: ignore[call-arg]
    async with AsyncConnectionPool(environment.database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)

        catalog = PostgresCatalogStore(pool)
        attributes = await catalog.read_attributes(level=COUNTRY)
        candidates = await PostgresCandidateStore(pool).read_candidates(level=COUNTRY)
        values = PostgresValueStore(pool)
        print(f"{len(candidates)} candidates, {len(attributes)} attributes in the catalog")

        for adapter in every_adapter(catalog, environment):
            print(
                f"\n{adapter.data_source} answers {len(adapter.attributes)} of them: "
                f"{', '.join(adapter.attributes)}"
            )
            outcome = await acquire(
                adapter=adapter, attributes=attributes, candidates=candidates, values=values
            )
            _report(outcome, len(candidates))

        # Last, so a substitute's figure fetched above is the one borrowed (reqs.md Q208).
        stand_ins = await catalog.read_stand_ins(level=COUNTRY)
        print(f"\n{STAND_IN}: {len(stand_ins)} declared")
        outcome = await stand_in(
            stand_ins=stand_ins, attributes=attributes, candidates=candidates, values=values
        )
        _report(outcome, len(candidates))

    return 0


def _report(outcome: object, candidates: int) -> None:
    stored = outcome.stored  # type: ignore[attr-defined]
    failures = outcome.failures  # type: ignore[attr-defined]
    print(f"  stored {len(stored)} values")
    for attribute in sorted({str(value.attribute) for value in stored}):
        found = [value for value in stored if str(value.attribute) == attribute]
        years = sorted({value.reference_period.end.year for value in found})
        print(f"    {attribute}: {len(found)} of {candidates} countries, years {years}")
    if failures:
        print(f"  {len(failures)} failures")
        for failure in failures:
            print(f"    {failure.attribute} {failure.candidate or ''}: {failure.reason}")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
