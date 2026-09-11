"""The async half of the database fixtures.

`tests/conftest.py` builds and migrates a database per workstream and hands out a
**synchronous** connection: the schema-conformance sweep PREPAREs statements and the
active-value tests read rows, and neither needs an event loop. The stores are async, so they
need a pool -- which is added here rather than by changing the fixture the other files use.

**Tests are isolated by emptying, not by rollback.** A store commits: `acquire` wraps
`pool.connection()`, and a connection block that exits normally commits, which is exactly the
per-item transaction of `arch.md` 7.1 and therefore part of what is under test. So the rows a
test writes are real rows, and they are removed afterwards.
"""

from collections.abc import AsyncIterator, Callable
from typing import Any

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

WRITABLE_TABLES = (
    "value",
    "fx_rate",
    "external_score",
    "household",
    "household_citizenship",
    "settings",
    "data_acquisition_run",
)
"""Everything a storage test may write.

`fx_rate` is here because a rate is fetched at runtime like any other figure -- the ECB
publishes daily and nothing seeds it -- so it is test data rather than catalog. The catalog is
not here and must not be: it is seeded by migration and read-only through this
seam (`arch.md` 1.2), so a test that emptied it would be testing a database the application
can never be in. CASCADE reaches the ten typed payload tables and the citation table, which
have no rows of their own that outlive their parent value, and a run's scope and failure rows.
`data_acquisition_run` joined when `test_run_store.py` began writing runs: the acceptance suite
counts them, so one left behind here would fail a test there for no reason of its own.
"""


async def _empty_writable_tables(connection: psycopg.AsyncConnection) -> None:
    await connection.execute(f"TRUNCATE {', '.join(WRITABLE_TABLES)} RESTART IDENTITY CASCADE")


@pytest.fixture
async def pool(database_url: str) -> AsyncIterator[AsyncConnectionPool]:
    """An open pool on the workstream's database, emptied of test rows afterwards."""
    async with AsyncConnectionPool(database_url, min_size=1, max_size=4, open=False) as open_pool:
        await open_pool.open(wait=True)
        try:
            yield open_pool
        finally:
            async with open_pool.connection() as connection:
                await _empty_writable_tables(connection)


@pytest.fixture
async def add_attribute(pool: AsyncConnectionPool) -> AsyncIterator[Callable[..., Any]]:
    """Add a catalog row for the duration of one test, then take it away again.

    Two things the seeded catalog cannot express are needed. The MVP catalog is the 41 country
    attributes (`reqs.md` 7.1), and it has **no Boolean, ShareComposition or Text attribute**
    -- those types arrive with the city level -- while `storage/queries/values.sql` has an
    insert for each and the dispatch that chooses between them has a branch for each. It also
    has **no retired attribute**, and retirement is what `read_attributes` keys its default
    off.

    Adding a row rather than skipping the case: the schema, not the seed, is what these tests
    are about, and a payload table nobody has ever written to is exactly the region of code the
    coverage bar exists to notice. The values written against these attributes go first, since
    a catalog row with values behind it is one nothing may delete (`arch.md` 7.4).
    """
    added: list[str] = []

    async def add(
        attribute_id: str,
        value_type: str,
        *,
        lifecycle_status: str = "active",
        pillar: str | None = "economics",
    ) -> str:
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO attribute (id, pillar, level, value_type, name, lifecycle_status)"
                " VALUES (%s, %s, 'country', %s, %s, %s)",
                (attribute_id, pillar, value_type, attribute_id, lifecycle_status),
            )
        added.append(attribute_id)
        return attribute_id

    yield add

    async with pool.connection() as connection:
        await _empty_writable_tables(connection)
        await connection.execute("DELETE FROM attribute WHERE id = ANY(%s)", (added,))
