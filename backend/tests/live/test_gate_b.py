"""Gate B's first assertion, against the real sources: every blocking attribute, for all 32.

`devplan.md` Gate B. The six `blocks_if_missing` attributes were chosen because each has a
source covering every candidate (`reqs.md` 7.5), so a gap in any of them is a broken fetch, not
an undocumented country -- and an unscoreable candidate. **Live, so never in `make check`**: it
fetches from Eurostat, the World Bank, WHO, the IMF and OECD, and a failure can mean one of them
was slow. Run it with `make live`.

It runs the same pass the application runs -- every adapter, then the declared stand-ins -- into
the test database, and reads the result through the active-value rule, as the ranking does.
OECD's Cloudflare front sometimes refuses a script (`catalog-blockers.md` item 5); the check is
expected to hold regardless, because the estimate answers the tax rate for everyone OECD misses.
"""

from collections.abc import AsyncIterator

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data_acquisition import execute_run
from starnest.data_sources.eurostat import EurostatAdapter, TaxWedgeEstimateAdapter
from starnest.data_sources.imf import ImfAdapter
from starnest.data_sources.oecd import OecdAdapter
from starnest.data_sources.open_meteo import OpenMeteoAdapter
from starnest.data_sources.who import WhoAdapter
from starnest.data_sources.world_bank import WorldBankAdapter
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresRunStore,
    PostgresValueStore,
)

pytestmark = pytest.mark.live

COUNTRY = "country"
THE_SHIPPED_SET = "local_employment"


@pytest.fixture
async def pool(database_url: str) -> AsyncIterator[AsyncConnectionPool]:
    async with AsyncConnectionPool(database_url, min_size=1, max_size=4, open=False) as pool:
        await pool.open(wait=True)
        try:
            yield pool
        finally:
            async with pool.connection() as connection:
                await connection.execute("TRUNCATE value, data_acquisition_run CASCADE")


async def test_every_blocking_attribute_answers_for_every_country(
    pool: AsyncConnectionPool,
) -> None:
    catalog = PostgresCatalogStore(pool)
    candidates = await PostgresCandidateStore(pool).read_candidates(level=COUNTRY)
    values = PostgresValueStore(pool)
    async with httpx.AsyncClient(timeout=120) as client:
        await execute_run(
            adapters=(
                EurostatAdapter(client),
                WorldBankAdapter(client),
                WhoAdapter(client),
                ImfAdapter(client),
                OecdAdapter(client),
                TaxWedgeEstimateAdapter(client),
                OpenMeteoAdapter(client, catalog),
            ),
            attributes=await catalog.read_attributes(level=COUNTRY),
            candidates=candidates,
            values=values,
            runs=PostgresRunStore(pool),
            level=COUNTRY,
            stand_ins=await catalog.read_stand_ins(level=COUNTRY),
        )

    shipped = await PostgresCriteriaStore(pool).read_criteria_set(THE_SHIPPED_SET, level=COUNTRY)
    blocking = sorted(str(c.attribute) for c in shipped.criteria if c.blocks_if_missing)
    active = await values.read_active_values(level=COUNTRY, attributes=blocking)
    answered = {(str(value.candidate), str(value.attribute)) for value in active}

    missing = [
        f"{candidate.id} has no {attribute}"
        for attribute in blocking
        for candidate in candidates
        if (str(candidate.id), attribute) not in answered
    ]
    assert len(blocking) == 6
    assert missing == []
