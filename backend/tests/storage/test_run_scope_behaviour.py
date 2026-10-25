"""A run's evidence is pinned to its items, its items to its scope, its scope to its level (`0513`;
PL-048: ST-12, SV-N10).

Each refusal is tried inside a transaction that is always rolled back, so nothing written here
outlives its test. The pre-check is replayed the same way: `0513` is undone, a row it must refuse
is written the old way, and `0513` is applied over it.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import AsyncConnectionPool
from yoyo.migrations import read_sql_migration

from starnest.data_acquisition import RunScope
from starnest.storage import PostgresRunStore

from .evaluation_rows import record_a_city

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0513-a-runs-evidence-is-pinned-to-its-items.sql"
ITS_ROLLBACK = THE_MIGRATION.with_name(f"{THE_MIGRATION.stem}.rollback.sql")

PORTUGAL = "country.portugal"
GREECE = "country.greece"
OVERBURDEN = "country.housing_cost_overburden_rate"
LISBON = "city.lisbon"


def _run(connection: psycopg.Connection, migration: Path) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        connection.execute(statement)


@pytest.fixture
def in_a_transaction(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with connection.transaction(force_rollback=True):
        yield connection


def a_run_over_portugal(connection: psycopg.Connection, *, status: str = "completed") -> int:
    """A country run whose one item is Portugal's overburden rate, written as the store writes."""
    row = connection.execute(
        "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
        "VALUES (now(), 'PL-048', %s, 'country') RETURNING id",
        (status,),
    ).fetchone()
    assert row is not None
    run = int(row[0])
    connection.execute(
        "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate, level) "
        "VALUES (%s, %s, 'country')",
        (run, PORTUGAL),
    )
    connection.execute(
        "INSERT INTO data_acquisition_run_attribute (data_acquisition_run, attribute, level) "
        "VALUES (%s, %s, 'country')",
        (run, OVERBURDEN),
    )
    connection.execute(
        "INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute) "
        "VALUES (%s, %s, %s)",
        (run, PORTUGAL, OVERBURDEN),
    )
    return run


def a_figure(connection: psycopg.Connection, candidate: str, run: int | None) -> None:
    connection.execute(
        "INSERT INTO value (candidate, attribute, value_type, data_source, data_acquisition_run, "
        "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
        "VALUES (%s, %s, 'Ratio', 'eurostat', %s, '2024-01-01', '2024-12-31', now(), 'high')",
        (candidate, OVERBURDEN, run),
    )


def refused(connection: psycopg.Connection, sql: str, params: tuple) -> bool:
    try:
        with connection.transaction():
            connection.execute(sql, params)
    except errors.ForeignKeyViolation:
        return True
    return False


class TestEvidenceIsOneOfItsRunsItems:
    def test_a_figure_for_a_pair_the_run_never_asked_about_is_refused(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        """Mutation: drop `value_is_one_of_its_run_s_items` and Greece's figure is stored under a
        run that asked about Portugal only."""
        run = a_run_over_portugal(in_a_transaction)

        with pytest.raises(errors.ForeignKeyViolation), in_a_transaction.transaction():
            a_figure(in_a_transaction, GREECE, run)

    def test_a_figure_for_one_of_its_items_is_kept(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        a_figure(in_a_transaction, PORTUGAL, a_run_over_portugal(in_a_transaction))

    def test_a_figure_with_no_run_is_untouched(self, in_a_transaction: psycopg.Connection) -> None:
        """A hand-entered or seeded figure carries no run, and nothing here asks it for one."""
        a_figure(in_a_transaction, GREECE, None)

    @pytest.mark.parametrize("table", ["data_acquisition_failure", "data_acquisition_run_reuse"])
    def test_a_failure_or_re_confirmation_outside_its_items_is_refused(
        self, in_a_transaction: psycopg.Connection, table: str
    ) -> None:
        run = a_run_over_portugal(in_a_transaction)
        columns = (
            "(data_acquisition_run, data_source, candidate, attribute, error_message) "
            "VALUES (%s, 'eurostat', %s, %s, 'declined')"
            if table == "data_acquisition_failure"
            else "(data_acquisition_run, data_source, candidate, attribute) "
            "VALUES (%s, 'eurostat', %s, %s)"
        )
        sql = f"INSERT INTO {table} {columns}"

        assert refused(in_a_transaction, sql, (run, GREECE, OVERBURDEN))
        assert not refused(in_a_transaction, sql, (run, PORTUGAL, OVERBURDEN))


class TestItemsSitInTheirScopeAndTheScopeAtItsLevel:
    def test_an_item_outside_the_scope_lists_is_refused(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        run = a_run_over_portugal(in_a_transaction)

        assert refused(
            in_a_transaction,
            "INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute) "
            "VALUES (%s, %s, %s)",
            (run, GREECE, OVERBURDEN),
        )

    def test_a_city_cannot_be_planned_into_a_country_run(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        run = a_run_over_portugal(in_a_transaction)
        record_a_city(in_a_transaction, city=LISBON, country=PORTUGAL)
        listing = (
            "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate, level) "
            "VALUES (%s, %s, %s)"
        )

        assert refused(in_a_transaction, listing, (run, LISBON, "country")), "not at its level"
        assert refused(in_a_transaction, listing, (run, LISBON, "city")), "not the run's level"

    async def test_the_store_refuses_a_scope_at_another_level_and_opens_no_run(
        self, pool: AsyncConnectionPool
    ) -> None:
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO candidate (id, name, level, parent_level, parent_candidate, "
                "parent_required) SELECT %s, %s, l.id, 'country', %s, l.requires_parent "
                "FROM level AS l WHERE l.id = 'city'",
                (LISBON, LISBON, PORTUGAL),
            )
        try:
            with pytest.raises(ValueError, match="at the run's level"):
                await PostgresRunStore(pool).start_run(
                    RunScope(level="country", candidates=(LISBON,), attributes=(OVERBURDEN,)),
                    triggered_by="PL-048",
                )
            async with pool.connection() as connection:
                cursor = await connection.execute("SELECT count(*) FROM data_acquisition_run")
                assert await cursor.fetchone() == (0,)
        finally:
            async with pool.connection() as connection:
                await connection.execute("DELETE FROM candidate WHERE id = %s", (LISBON,))


class TestItRefusesBeforeChangingAnything:
    def test_rows_it_would_break_are_named_and_nothing_is_keyed(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        _run(in_a_transaction, ITS_ROLLBACK)
        run = in_a_transaction.execute(
            "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
            "VALUES (now(), 'PL-048', 'running', 'country') RETURNING id"
        ).fetchone()
        assert run is not None
        a_figure(in_a_transaction, GREECE, int(run[0]))

        with (
            pytest.raises(errors.RaiseException) as refusal,
            in_a_transaction.transaction(),
        ):
            _run(in_a_transaction, THE_MIGRATION)

        message = str(refusal.value)
        assert f"a run still running: 1, e.g. run {run[0]}" in message
        assert "a value outside its run's items: 1, e.g. value" in message
        assert f"from run {run[0]}, {GREECE}, {OVERBURDEN}" in message
        assert (
            in_a_transaction.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = 'value_is_one_of_its_run_s_items'"
            ).fetchone()
            is None
        )

    def test_it_applies_again_after_its_rollback_and_copies_each_run_s_level(
        self, in_a_transaction: psycopg.Connection
    ) -> None:
        _run(in_a_transaction, ITS_ROLLBACK)
        in_a_transaction.execute(
            "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
            "VALUES (now(), 'PL-048', 'completed', 'country')"
        )
        in_a_transaction.execute(
            "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate) "
            "SELECT id, %s FROM data_acquisition_run WHERE triggered_by = 'PL-048'",
            (PORTUGAL,),
        )

        _run(in_a_transaction, THE_MIGRATION)

        assert in_a_transaction.execute(
            "SELECT s.level FROM data_acquisition_run_candidate AS s "
            "JOIN data_acquisition_run AS r ON r.id = s.data_acquisition_run "
            "WHERE r.triggered_by = 'PL-048'"
        ).fetchall() == [("country",)]
