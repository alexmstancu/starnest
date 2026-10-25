"""A run records its plan, ceiling and cap as it opens (`0512`; PL-055, PL-056, C04-N6).

The store writes what `open_run` planned in the run's opening transaction and marks each
(source, attribute) as the run gets through it. The schema holds the record whole: a plan only
for an attribute in the run's scope, sums that are finite and not negative, and a way back that
refuses once any run has recorded one.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import AsyncConnectionPool
from yoyo.migrations import read_sql_migration

from starnest.data import DataSourceId
from starnest.data_acquisition import RunPlan, RunScope
from starnest.storage import PostgresRunStore

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
ITS_ROLLBACK = MIGRATIONS / "0512-a-run-records-its-plan.rollback.sql"

OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
A_SCOPE = RunScope(
    level="country",
    candidates=("country.portugal", "country.spain"),
    attributes=(OVERBURDEN, OVERCROWDING),
)


def a_plan() -> RunPlan:
    return RunPlan(
        items_planned={("eurostat", OVERBURDEN): 2, ("oecd", OVERCROWDING): 2},
        estimate_ceiling_eur=Decimal("0.42"),
        spend_cap_eur=Decimal("5.00"),
        accepted_uncapped=False,
    )


async def _rows(pool: AsyncConnectionPool, sql: str, *params: object) -> list[tuple]:
    async with pool.connection() as connection:
        cursor = await connection.execute(sql, params)
        return await cursor.fetchall()


class TestWhatTheStoreRecords:
    async def test_the_plan_and_its_money_are_written_with_the_run(
        self, pool: AsyncConnectionPool
    ) -> None:
        run = await PostgresRunStore(pool).start_run(A_SCOPE, triggered_by="test", plan=a_plan())

        assert await _rows(
            pool,
            "SELECT data_source, attribute, items_planned, finished_at "
            "FROM data_acquisition_run_plan WHERE data_acquisition_run = %s ORDER BY 1",
            run,
        ) == [("eurostat", OVERBURDEN, 2, None), ("oecd", OVERCROWDING, 2, None)]
        [(recorded, ceiling, cap, accepted)] = await _rows(
            pool,
            "SELECT plan_recorded_at, estimate_ceiling_eur, spend_cap_eur, accepted_uncapped "
            "FROM data_acquisition_run WHERE id = %s",
            run,
        )
        assert recorded is not None
        assert (ceiling, cap, accepted) == (Decimal("0.42"), Decimal("5.00"), False)

    async def test_a_run_opened_without_a_plan_records_none_of_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The shape of a run from before `0512`: every field null, read as "not recorded"."""
        run = await PostgresRunStore(pool).start_run(A_SCOPE, triggered_by="test")

        assert await _rows(
            pool,
            "SELECT plan_recorded_at, estimate_ceiling_eur, spend_cap_eur, accepted_uncapped "
            "FROM data_acquisition_run WHERE id = %s",
            run,
        ) == [(None, None, None, None)]
        assert (
            await _rows(
                pool, "SELECT 1 FROM data_acquisition_run_plan WHERE data_acquisition_run = %s", run
            )
            == []
        )

    async def test_asking_a_source_to_the_end_marks_only_that_row_and_only_once(
        self, pool: AsyncConnectionPool
    ) -> None:
        store = PostgresRunStore(pool)
        run = await store.start_run(A_SCOPE, triggered_by="test", plan=a_plan())

        await store.mark_asked(run, DataSourceId("eurostat"), OVERBURDEN)
        [(first,)] = await _rows(
            pool,
            "SELECT finished_at FROM data_acquisition_run_plan "
            "WHERE data_acquisition_run = %s AND data_source = 'eurostat'",
            run,
        )
        await store.mark_asked(run, DataSourceId("eurostat"), OVERBURDEN)

        assert await _rows(
            pool,
            "SELECT data_source, finished_at FROM data_acquisition_run_plan "
            "WHERE data_acquisition_run = %s ORDER BY 1",
            run,
        ) == [("eurostat", first), ("oecd", None)]

    async def test_a_plan_for_an_attribute_outside_the_scope_opens_no_run(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The plan and the scope are one transaction, so the refusal leaves no run behind."""
        outside = RunPlan(
            items_planned={("eurostat", "country.press_freedom_index"): 1},
            estimate_ceiling_eur=Decimal(0),
            spend_cap_eur=None,
            accepted_uncapped=False,
        )

        with pytest.raises(errors.ForeignKeyViolation):
            await PostgresRunStore(pool).start_run(A_SCOPE, triggered_by="test", plan=outside)

        assert await _rows(pool, "SELECT 1 FROM data_acquisition_run") == []


A_RUN = (
    "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level, "
    "plan_recorded_at, estimate_ceiling_eur, spend_cap_eur, accepted_uncapped) "
    "VALUES (now(), 'test', 'completed', 'country', %s, %s, %s, %s)"
)


@pytest.fixture
def in_a_transaction(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        yield connection


@pytest.mark.parametrize(
    ("recorded", "ceiling", "cap", "accepted"),
    [
        pytest.param(datetime.now(UTC), Decimal("NaN"), None, False, id="a NaN ceiling"),
        pytest.param(datetime.now(UTC), Decimal("Infinity"), None, False, id="an infinite one"),
        pytest.param(datetime.now(UTC), Decimal(0), Decimal(-1), False, id="a negative cap"),
        pytest.param(datetime.now(UTC), None, None, False, id="a plan with no ceiling"),
        pytest.param(None, Decimal(0), None, None, id="a ceiling with no plan"),
    ],
)
def test_the_schema_refuses_a_plan_that_is_not_whole_and_finite(
    in_a_transaction: psycopg.Connection,
    recorded: datetime | None,
    ceiling: Decimal | None,
    cap: Decimal | None,
    accepted: bool | None,
) -> None:
    with pytest.raises(errors.CheckViolation), in_a_transaction.transaction():
        in_a_transaction.execute(A_RUN, (recorded, ceiling, cap, accepted))


def _roll_back(connection: psycopg.Connection) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(ITS_ROLLBACK))
    for statement in statements:
        connection.execute(statement)


def test_its_way_back_refuses_once_a_run_recorded_its_plan(
    in_a_transaction: psycopg.Connection,
) -> None:
    in_a_transaction.execute(A_RUN, (datetime.now(UTC), Decimal(0), None, False))

    with (
        pytest.raises(errors.RaiseException, match="cannot roll back 0512: 1 run"),
        in_a_transaction.transaction(),
    ):
        _roll_back(in_a_transaction)


def test_its_way_back_runs_while_no_run_recorded_one(
    in_a_transaction: psycopg.Connection,
) -> None:
    """The fresh database's case, so the drop stays exercised: an old-style run loses nothing."""
    in_a_transaction.execute(A_RUN, (None, None, None, None))

    _roll_back(in_a_transaction)

    assert in_a_transaction.execute(
        "SELECT to_regclass('data_acquisition_run_plan')"
    ).fetchone() == (None,)
