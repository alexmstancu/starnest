"""Reordering the sources is one locked transaction (D36, PL-136, PL-137).

The catalog is not emptied between storage tests, so every test here writes the seeded
priorities back afterwards, number for number.
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import InvalidSourceOrderError
from starnest.storage import PostgresCatalogStore

pytestmark = pytest.mark.storage


@pytest.fixture
async def catalog(pool: AsyncConnectionPool) -> AsyncIterator[PostgresCatalogStore]:
    async with pool.connection() as connection:
        seeded = await (
            await connection.execute("SELECT id, default_priority FROM data_source")
        ).fetchall()
    try:
        yield PostgresCatalogStore(pool)
    finally:
        async with pool.connection() as connection:
            for identifier, priority in seeded:
                await connection.execute(
                    "UPDATE data_source SET default_priority = %s WHERE id = %s",
                    (priority, identifier),
                )


async def _priorities(catalog: PostgresCatalogStore) -> dict[str, int]:
    return {str(s.id): s.default_priority for s in await catalog.read_data_sources()}


class _FailingAfterTheWrite:
    """The real queries, except that the moment the priorities are written, the write fails."""

    def __init__(self, queries: Any) -> None:
        self._queries = queries

    def __getattr__(self, name: str) -> Any:
        return getattr(self._queries, name)

    async def update_data_source_priorities(self, connection: Any, **parameters: Any) -> None:
        await self._queries.update_data_source_priorities(connection, **parameters)
        raise RuntimeError("the connection dropped after the write")


async def test_a_reorder_that_fails_after_writing_leaves_nothing_changed(
    catalog: PostgresCatalogStore,
) -> None:
    before = await _priorities(catalog)
    catalog._queries = _FailingAfterTheWrite(catalog._queries)

    with pytest.raises(RuntimeError):
        await catalog.reorder_data_sources(list(reversed(before)))

    assert await _priorities(catalog) == before


async def test_a_refused_order_writes_nothing(catalog: PostgresCatalogStore) -> None:
    before = await _priorities(catalog)

    with pytest.raises(InvalidSourceOrderError):
        await catalog.reorder_data_sources([*reversed(before), "no_such_source"])

    assert await _priorities(catalog) == before


async def test_a_reorder_waits_for_one_in_flight_and_then_reads_what_it_wrote(
    pool: AsyncConnectionPool, catalog: PostgresCatalogStore
) -> None:
    """Concurrent reorders serialise: the second reorders the tiers the first committed."""
    ordered = [str(s.id) for s in await catalog.read_data_sources()]
    top, top_priority = ordered[0], (await _priorities(catalog))[ordered[0]]
    async with pool.connection() as holder:
        await holder.execute("SELECT id FROM data_source ORDER BY id FOR UPDATE")
        waiting = asyncio.create_task(catalog.reorder_data_sources([*ordered[1:], top]))
        await asyncio.sleep(0.3)
        assert not waiting.done(), "the reorder did not wait for the lock"
        await holder.execute(
            "UPDATE data_source SET default_priority = %s WHERE id = %s", (top_priority - 1000, top)
        )
    reordered = {str(s.id): s.default_priority for s in await waiting}

    assert min(reordered.values()) == top_priority - 1000, "it reordered the tiers it read early"
    assert [str(s.id) for s in await catalog.read_data_sources()] == [*ordered[1:], top]
