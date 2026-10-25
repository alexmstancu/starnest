"""What `0511` makes of the re-confirmations already recorded, and when its way back refuses
(PL-049, UF-073, C04-N5).

Run inside one transaction that is always rolled back: the rollback's statements take the schema
back to before `0511`, re-confirmations are written the old way -- naming no figure -- and `0511`
is applied over them, so the backfill is asserted on rows it really had to fill.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_MIGRATION = MIGRATIONS / "0511-a-re-confirmation-names-the-figure-it-restated.sql"
ITS_ROLLBACK = THE_MIGRATION.with_name(f"{THE_MIGRATION.stem}.rollback.sql")

OVERBURDEN = "country.housing_cost_overburden_rate"
ONE_ROW = "country.estonia"
TWO_ROWS = "country.latvia"
TRANSCRIBED = datetime(2026, 9, 19, tzinfo=UTC)
RUN_STARTED = datetime(2026, 10, 1, tzinfo=UTC)
AFTER_THE_RUN = datetime(2026, 10, 5, tzinfo=UTC)


def _run(connection: psycopg.Connection, migration: Path) -> None:
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    for statement in statements:
        connection.execute(statement)


def _a_figure(
    connection: psycopg.Connection,
    candidate: str,
    retrieved: datetime,
    period_year: int,
    source: str = "eurostat",
) -> int:
    row = connection.execute(
        "INSERT INTO value (candidate, attribute, value_type, data_source, "
        "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
        "VALUES (%s, %s, 'Ratio', %s, %s, %s, %s, 'high') RETURNING id",
        (candidate, OVERBURDEN, source, f"{period_year}-01-01", f"{period_year}-12-31", retrieved),
    ).fetchone()
    assert row is not None
    figure = int(row[0])
    connection.execute(
        "INSERT INTO value_ratio (value_id, value_type, value, basis) "
        "VALUES (%s, 'Ratio', 8.2, 'population')",
        (figure,),
    )
    # Judged now rather than at COMMIT (0519): a rollback that drops a key on `value` cannot run
    # while a figure's completeness check is still pending.
    connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
    connection.execute("SET CONSTRAINTS ALL DEFERRED")
    return figure


@pytest.fixture
def before_it(connection: psycopg.Connection) -> Iterator[tuple[psycopg.Connection, int, int]]:
    """The schema as `0510` left it: one run re-confirming two pairs, by source and pair only.

    Portugal has one row from that source on record before the run began, and one written after
    it, which the run cannot have restated. Greece has two before it, so which one the run
    restated cannot be told. Always rolled back.
    """
    with connection.transaction(force_rollback=True):
        _run(connection, ITS_ROLLBACK)
        restated = _a_figure(connection, ONE_ROW, TRANSCRIBED, 2024)
        _a_figure(connection, ONE_ROW, AFTER_THE_RUN, 2025)
        _a_figure(connection, TWO_ROWS, TRANSCRIBED, 2024)
        _a_figure(connection, TWO_ROWS, TRANSCRIBED, 2025)
        row = connection.execute(
            "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
            "VALUES (%s, 'PL-049 backfill', 'completed', 'country') RETURNING id",
            (RUN_STARTED,),
        ).fetchone()
        assert row is not None
        run = int(row[0])
        for candidate in (ONE_ROW, TWO_ROWS):
            connection.execute(
                "INSERT INTO data_acquisition_run_reuse "
                "(data_acquisition_run, data_source, candidate, attribute) "
                "VALUES (%s, 'eurostat', %s, %s)",
                (run, candidate, OVERBURDEN),
            )
        yield connection, run, restated


def _named(connection: psycopg.Connection, run: int, candidate: str) -> int | None:
    row = connection.execute(
        "SELECT value FROM data_acquisition_run_reuse "
        "WHERE data_acquisition_run = %s AND candidate = %s",
        (run, candidate),
    ).fetchone()
    assert row is not None
    return row[0]


def test_a_re_confirmation_with_one_row_it_could_have_restated_names_that_row(
    before_it: tuple[psycopg.Connection, int, int],
) -> None:
    connection, run, restated = before_it

    _run(connection, THE_MIGRATION)

    assert _named(connection, run, ONE_ROW) == restated


def test_another_sources_row_for_the_pair_does_not_make_it_ambiguous(
    before_it: tuple[psycopg.Connection, int, int],
) -> None:
    """The re-confirmation names its source, so only that source's rows could have been
    restated: another source's figure for the pair is a different observation, not a second
    candidate for the one re-read."""
    connection, run, restated = before_it
    _a_figure(connection, ONE_ROW, TRANSCRIBED, 2024, source="oecd")

    _run(connection, THE_MIGRATION)

    assert _named(connection, run, ONE_ROW) == restated


def test_a_re_confirmation_with_two_rows_it_could_have_restated_names_neither(
    before_it: tuple[psycopg.Connection, int, int],
) -> None:
    """C04-N5. Guessing the latest would be wrong wherever the run re-read an older
    transcription than the newest on record, and a wrong id reads "unchanged" where null reads
    "refreshed" -- so null, the honest one."""
    connection, run, _restated = before_it

    _run(connection, THE_MIGRATION)

    assert _named(connection, run, TWO_ROWS) is None


def test_its_way_back_refuses_once_a_re_confirmation_names_its_figure(
    before_it: tuple[psycopg.Connection, int, int],
) -> None:
    connection, _run_id, _restated = before_it
    _run(connection, THE_MIGRATION)

    with (
        pytest.raises(errors.RaiseException, match="cannot roll back 0511: 1 re-confirmation"),
        connection.transaction(),
    ):
        _run(connection, ITS_ROLLBACK)


def test_its_way_back_runs_while_no_re_confirmation_names_a_figure(
    before_it: tuple[psycopg.Connection, int, int],
) -> None:
    """The fresh database's case, so the drop stays exercised: nothing named, nothing lost."""
    connection, _run_id, _restated = before_it
    _run(connection, THE_MIGRATION)
    connection.execute("UPDATE data_acquisition_run_reuse SET value = NULL")

    _run(connection, ITS_ROLLBACK)

    columns = connection.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'data_acquisition_run_reuse' AND column_name = 'value'"
    ).fetchall()
    assert columns == []
