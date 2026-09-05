"""The API as a client sees it, over HTTP, against a real database.

`arch.md` 6.1: the acceptance suite is **another client of the same contract**, which is what
makes the API a real boundary rather than an intention. It calls the app the composition root
builds, wired to the same PostgreSQL stores the server uses -- so a response here is a response,
not a mock's opinion of one.

The database is the workstream's own, dropped and migrated per session by `tests/conftest.py`,
and it holds the seeded catalog. Values are written by the tests that need them and removed
afterwards, exactly as the storage suite does.
"""

from collections.abc import AsyncIterator

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.api import build_app
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresHouseholdStore,
    PostgresValueStore,
)

WRITABLE_TABLES = ("value", "household", "household_citizenship", "settings")
"""What an acceptance test may write and what is emptied afterwards.

**The criteria tables are not here**, and a test that changes a criteria set must therefore
make its own. The seeded catalog is read by every other suite, so a test that edited a shipped
weight would leave the next one reading a number nobody put there -- which happened once, and
is why `a_scratch_criteria_set` exists.
"""


@pytest.fixture
async def api(database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """A client speaking to the real application, over ASGI rather than a socket.

    No port, no server process: `ASGITransport` runs the same app object the composition root
    builds. What is under test is the application, and binding a socket would only add a way for
    the test to fail for reasons that are not about it.
    """
    async with AsyncConnectionPool(database_url, min_size=1, max_size=4, open=False) as pool:
        await pool.open(wait=True)
        app = build_app(
            households=PostgresHouseholdStore(pool),
            criteria_store=PostgresCriteriaStore(pool),
            candidates=PostgresCandidateStore(pool),
            values=PostgresValueStore(pool),
            catalog_store=PostgresCatalogStore(pool),
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
            try:
                yield client
            finally:
                async with pool.connection() as connection:
                    await connection.execute(
                        f"TRUNCATE {', '.join(WRITABLE_TABLES)} RESTART IDENTITY CASCADE"
                    )


@pytest.fixture
async def a_scratch_criteria_set(database_url: str) -> AsyncIterator[str]:
    """A copy of the shipped `minimal` set, for tests that change a weight.

    Duplicated rather than built by hand so it has the shape the application actually ships --
    two pillars, three criteria, percentile throughout -- while belonging to the test that uses
    it. `duplicate_criteria_set` is the same query the product's own duplicate feature uses.
    """
    scratch = "acceptance_scratch"
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        criteria = PostgresCriteriaStore(pool)
        await criteria.create_criteria_set(
            (await criteria.read_criteria_set("minimal")).duplicated_as(scratch, "Scratch")
        )
        try:
            yield scratch
        finally:
            await criteria.delete_criteria_set(scratch)


@pytest.fixture
async def stored_figures(database_url: str) -> AsyncIterator[None]:
    """Real figures for two countries, so a response is checked with data in it as well as
    without.

    Two shapes, not one: an endpoint that validates when every field is null and fails when they
    carry numbers is the likelier of the two to ship, because nulls are what a first test reaches
    and numbers are what a user sees.
    """
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.data import (
        ConfidenceLevel,
        Quantity,
        Ratio,
        ReferencePeriod,
        Value,
        ValueType,
    )

    a_year = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))

    def a_figure(candidate: str, attribute: str, figure: str) -> Value:
        satisfaction = attribute == "country.life_satisfaction"
        return Value(
            candidate=candidate,
            attribute=attribute,
            value_type=ValueType.QUANTITY if satisfaction else ValueType.RATIO,
            data_source="eurostat",
            reference_period=a_year,
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=(
                Quantity(magnitude=Decimal(figure), unit="ladder_points")
                if satisfaction
                else Ratio(value=Decimal(figure), basis="households")
            ),
        )

    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, 100)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = 100"
            )
        await PostgresValueStore(pool).append(
            [
                a_figure("country.portugal", "country.housing_cost_overburden_rate", "5"),
                a_figure("country.portugal", "country.overcrowding_rate", "9"),
                a_figure("country.portugal", "country.life_satisfaction", "7.1"),
                a_figure("country.greece", "country.housing_cost_overburden_rate", "28"),
                a_figure("country.greece", "country.overcrowding_rate", "27"),
                a_figure("country.greece", "country.life_satisfaction", "6.4"),
            ]
        )
    yield
