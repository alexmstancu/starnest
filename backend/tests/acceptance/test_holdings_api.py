"""`GET /holdings`: what the database holds at a level, against the design (PL-051, PL-052, PL-054).

The figures and their arithmetic are proved in `tests/storage/test_holdings.py`; this is the
client's view -- the shape the design promises, populated with every kind of gap, and the
refusals the parameters can earn.
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import (
    ConfidenceLevel,
    DataSourceId,
    Ratio,
    ReferencePeriod,
    Value,
    ValueType,
)
from starnest.storage import (
    PostgresCatalogStore,
    PostgresHouseholdStore,
    PostgresRunStore,
    PostgresValueStore,
)

from .conftest import a_stub_source, an_api
from .contract import undeclared_fields, validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MONTH_START = "2026-10-01T00:00:00+03:00"
DECLINES_FOR = "country.portugal"
HAS_NO_ROW_FOR = "country.liechtenstein"
BORROWS_A_NEIGHBOURS_FIGURES = HAS_NO_ROW_FOR


async def test_a_database_with_every_kind_of_gap_matches_the_designed_shape(
    database_url: str,
) -> None:
    source = a_stub_source(silent_about=(DECLINES_FOR,), no_row_for=(HAS_NO_ROW_FOR,))
    async with an_api(database_url, (source,)) as api:
        await api.post(
            "/v1/data-acquisition-runs",
            json={"level": COUNTRY, "candidates": [DECLINES_FOR, HAS_NO_ROW_FOR, "country.spain"]},
        )

        response = await api.get("/v1/holdings", params={"level": COUNTRY, "since": MONTH_START})

    body = response.json()
    assert response.status_code == 200
    validate("getHoldings", body)
    assert undeclared_fields("getHoldings", body) == []
    gaps = body["gaps"]
    assert {gap["candidate"] for gap in gaps["failed"]} == {DECLINES_FOR}
    assert {gap["candidate"] for gap in gaps["unanswered"]} == {HAS_NO_ROW_FOR}
    assert body["values_stored"] == 2
    assert (
        body["values_stored"] + sum(len(listed) for listed in gaps.values())
        == (body["pairs_total"])
    )


async def test_an_unknown_level_is_refused_naming_it(api: httpx.AsyncClient) -> None:
    response = await api.get("/v1/holdings", params={"level": "planet", "since": MONTH_START})

    assert response.status_code == 422
    assert response.json()["code"] == "unknown_scope"
    assert response.json()["details"] == {"level": "planet", "unknown_levels": ["planet"]}


@pytest.mark.parametrize("since", [None, "2026-10-01T00:00:00", "the first"])
async def test_a_month_start_that_is_missing_or_has_no_zone_is_refused(
    api: httpx.AsyncClient, since: str | None
) -> None:
    """The browser's own month boundary (C04-N10). A time with no zone would be read in the
    database's, which is the clock decision the request exists to keep off the server."""
    params = {"level": COUNTRY} | ({} if since is None else {"since": since})

    response = await api.get("/v1/holdings", params=params)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


async def test_a_switched_off_source_s_attributes_are_not_counted_as_fetchable(
    api: httpx.AsyncClient,
) -> None:
    """The pairs are what a source the household consults can fetch (Q232). With the only
    source off, what is left is what a stand-in can lend."""
    params = {"level": COUNTRY, "since": MONTH_START}
    before = (await api.get("/v1/holdings", params=params)).json()["pairs_total"]
    try:
        switched = await api.patch("/v1/data-sources/eurostat", json={"is_enabled": False})
        assert switched.status_code == 200

        after = (await api.get("/v1/holdings", params=params)).json()
    finally:
        restored = await api.patch("/v1/data-sources/eurostat", json={"is_enabled": True})
        assert restored.status_code == 200

    assert before - after["pairs_total"] == 32 * 2
    lent = {gap["candidate"] for gap in after["gaps"]["not_reached"]}
    assert after["pairs_total"] > 0
    assert lent == {BORROWS_A_NEIGHBOURS_FIGURES}


SPAIN = "country.spain"
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
TAX = "country.total_tax_rate_effective"
"""One of the four figures Liechtenstein borrows from Switzerland (`0460`)."""


def a_figure(
    candidate: str, attribute: str, *, source: str = "eurostat", days_ago: int = 0
) -> Value:
    basis = "labour_cost" if attribute == TAX else "households"
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source=source,
        reference_period=ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31)),
        retrieval_date=datetime.now(UTC) - timedelta(days=days_ago),
        confidence_level=ConfidenceLevel.LOW if source == "stand_in" else ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("30"), basis=basis),
    )


@asynccontextmanager
async def a_pool(database_url: str) -> AsyncIterator[AsyncConnectionPool]:
    async with AsyncConnectionPool(database_url, min_size=1, max_size=2, open=False) as pool:
        await pool.open(wait=True)
        yield pool


@asynccontextmanager
async def put_back_afterwards(pool: AsyncConnectionPool, source: str) -> AsyncIterator[None]:
    """The catalog is not test data, so a switch is restored to exactly what it was."""
    catalog = PostgresCatalogStore(pool)
    (before,) = [each for each in await catalog.read_data_sources() if each.id == source]
    try:
        yield
    finally:
        await catalog.set_data_source(DataSourceId(source), is_enabled=before.is_enabled)


def landing_mid_read(
    monkeypatch: pytest.MonkeyPatch,
    read: tuple[type, str],
    change: Callable[[], Awaitable[None]],
) -> None:
    """`change` commits once while the endpoint answers: the moment `read` returns, or -- if the
    endpoint never makes that read -- just before the holdings are read. Those are the two
    places the old endpoint and a one-statement endpoint each leave open."""
    landed = False

    async def land() -> None:
        nonlocal landed
        if not landed:
            landed = True
            await change()

    store, name = read
    original_read = getattr(store, name)
    original_holdings = PostgresRunStore.read_holdings

    async def read_then_land(self: object, *args: object, **kwargs: object) -> object:
        result = await original_read(self, *args, **kwargs)
        await land()
        return result

    async def land_then_read_holdings(self: PostgresRunStore, **kwargs: Any) -> object:
        await land()
        return await original_holdings(self, **kwargs)

    monkeypatch.setattr(store, name, read_then_land)
    monkeypatch.setattr(PostgresRunStore, "read_holdings", land_then_read_holdings)


async def read_across(
    api: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    read: tuple[type, str],
    change: Callable[[], Awaitable[None]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """The holdings before the change, while it lands, and after it."""
    params = {"level": COUNTRY, "since": MONTH_START}
    before = (await api.get("/v1/holdings", params=params)).json()
    with monkeypatch.context() as patched:
        landing_mid_read(patched, read, change)
        during = (await api.get("/v1/holdings", params=params)).json()
    after = (await api.get("/v1/holdings", params=params)).json()
    return before, during, after


def figures(body: dict[str, Any]) -> tuple[object, ...]:
    return (body["pairs_total"], body["values_stored"], body["values_older_than_refetch_age"])


class TestOneCommittedState:
    """What the database holds describes one committed state, whatever commits while it is read.

    The review paused after the source switches were read, switched Eurostat off and resumed:
    `(pairs_total, values_stored)` was (68, 1) before, (68, 0) during and (4, 0) afterwards --
    a state the database was never in, with 67 fetchable gaps it did not have.
    """

    async def test_a_source_switched_off_mid_read_is_seen_everywhere_or_nowhere(
        self, database_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async with a_pool(database_url) as pool, put_back_afterwards(pool, "eurostat"):
            await PostgresValueStore(pool).append([a_figure(SPAIN, OVERBURDEN)])

            async def switch_eurostat_off() -> None:
                await PostgresCatalogStore(pool).set_data_source(
                    DataSourceId("eurostat"), is_enabled=False
                )

            async with an_api(database_url, (a_stub_source(),)) as api:
                before, during, after = await read_across(
                    api,
                    monkeypatch,
                    (PostgresCatalogStore, "read_data_sources"),
                    switch_eurostat_off,
                )

        assert figures(before) != figures(after)
        assert during in (before, after), (figures(before), figures(during), figures(after))

    async def test_the_stand_in_source_switched_off_mid_read_is_seen_everywhere_or_nowhere(
        self, database_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async with a_pool(database_url) as pool, put_back_afterwards(pool, "stand_in"):
            await PostgresValueStore(pool).append(
                [a_figure(BORROWS_A_NEIGHBOURS_FIGURES, TAX, source="stand_in")]
            )

            async def switch_stand_ins_off() -> None:
                await PostgresCatalogStore(pool).set_data_source(
                    DataSourceId("stand_in"), is_enabled=False
                )

            async with an_api(database_url, (a_stub_source(),)) as api:
                before, during, after = await read_across(
                    api,
                    monkeypatch,
                    (PostgresCatalogStore, "read_data_sources"),
                    switch_stand_ins_off,
                )

        assert figures(before) != figures(after)
        assert during in (before, after), (figures(before), figures(during), figures(after))

    async def test_a_refetch_age_set_mid_read_is_read_with_the_values_it_ages(
        self, database_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Set, then a figure stored: neither moment had an unset age beside two figures."""
        async with a_pool(database_url) as pool:
            await PostgresValueStore(pool).append([a_figure(SPAIN, OVERBURDEN, days_ago=10)])

            async def set_the_age_then_store_a_figure() -> None:
                async with pool.connection() as connection:
                    await connection.execute(
                        "INSERT INTO settings (id, refetch_older_than_days) VALUES (1, 5)"
                        " ON CONFLICT (id) DO UPDATE SET refetch_older_than_days = 5"
                    )
                await PostgresValueStore(pool).append([a_figure(SPAIN, OVERCROWDING, days_ago=10)])

            async with an_api(database_url, (a_stub_source(),)) as api:
                before, during, after = await read_across(
                    api,
                    monkeypatch,
                    (PostgresHouseholdStore, "get_settings"),
                    set_the_age_then_store_a_figure,
                )

        assert figures(before) == (68, 1, None)
        assert figures(after) == (68, 2, 2)
        assert during in (before, after), (figures(before), figures(during), figures(after))
