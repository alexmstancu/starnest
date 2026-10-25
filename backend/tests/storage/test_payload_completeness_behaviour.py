"""0519: an accepted figure carries its payload, and a composition sums to 100 (PL-168: ST-15).

The domain refuses both states on read, and `select_active_values` reads a whole level, so one
such row stored by any route but the application's -- `psql`, a restore, a second client -- made
every ranking at its level answer 500. The rules span rows, so they are deferred constraint
triggers judged at COMMIT; each test here asks for that judgement early with `SET CONSTRAINTS ALL
IMMEDIATE`, inside a transaction that is always rolled back.
"""

from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

from starnest.data.payloads import SHARE_SUM_TOLERANCE

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
MIGRATION = "0519-an-accepted-figure-carries-its-payload"
FUNCTIONS = {"value_carries_its_payload", "value_is_complete", "value_shares_sum_to_100"}

#: One payload row per type, as `values.sql` writes it; `%(id)s` is the figure's id.
PAYLOADS = {
    "Monetary": "INSERT INTO value_monetary (value_id, value_type, amount, currency, amount_eur)"
    " VALUES (%(id)s, 'Monetary', 1200, 'EUR', 1200)",
    "Quantity": "INSERT INTO value_quantity (value_id, value_type, magnitude, unit)"
    " VALUES (%(id)s, 'Quantity', 480, 'pisa_points')",
    "Count": "INSERT INTO value_count (value_id, value_type, count) VALUES (%(id)s, 'Count', 3)",
    "Ratio": "INSERT INTO value_ratio (value_id, value_type, value, basis)"
    " VALUES (%(id)s, 'Ratio', 12.5, 'total_employment')",
    "Index": "INSERT INTO value_index (value_id, value_type, value, provider, scale_min, scale_max)"
    " VALUES (%(id)s, 'Index', 70, 'rsf', 0, 100)",
    "LabelSet": "INSERT INTO value_labelset (value_id, value_type, label)"
    " VALUES (%(id)s, 'LabelSet', 'Cfb'), (%(id)s, 'LabelSet', 'Csa')",
    "ShareComposition": "INSERT INTO value_sharecomp (value_id, value_type, label, share)"
    " VALUES (%(id)s, 'ShareComposition', 'English', 60),"
    " (%(id)s, 'ShareComposition', 'German', 40)",
    "Boolean": "INSERT INTO value_boolean (value_id, value_type, value)"
    " VALUES (%(id)s, 'Boolean', true)",
    "AssignedScore": "INSERT INTO value_score (value_id, value_type, value, range_min, range_max,"
    " assigned_by) VALUES (%(id)s, 'AssignedScore', 3, 1, 5, 'human')",
    "Text": "INSERT INTO value_text (value_id, value_type, body) VALUES (%(id)s, 'Text', 'Calm')",
}
PAYLOAD_TABLES = {
    "Monetary": "value_monetary",
    "Quantity": "value_quantity",
    "Count": "value_count",
    "Ratio": "value_ratio",
    "Index": "value_index",
    "LabelSet": "value_labelset",
    "ShareComposition": "value_sharecomp",
    "Boolean": "value_boolean",
    "AssignedScore": "value_score",
    "Text": "value_text",
}


@pytest.fixture
def rolled_back(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """The connection inside a transaction that is always undone, with one attribute per type."""
    with connection.transaction(force_rollback=True):
        for value_type in PAYLOADS:
            connection.execute(
                "INSERT INTO attribute (id, pillar, level, value_type, name)"
                " VALUES (%s, 'economics', 'country', %s, %s)",
                (attribute_of(value_type), value_type, value_type),
            )
        yield connection


def attribute_of(value_type: str) -> str:
    return f"country.payload_completeness_{value_type.lower()}"


def a_figure(
    connection: psycopg.Connection,
    value_type: str,
    *,
    rejection_reason: str | None = None,
    retrieved: str = "2026-10-01T10:00:00Z",
) -> int:
    row = connection.execute(
        "INSERT INTO value (candidate, attribute, value_type, data_source, reference_period_start,"
        " reference_period_end, retrieval_date, confidence_level, rejection_reason)"
        " VALUES ('country.romania', %s, %s, 'eurostat', '2025-01-01', '2025-12-31', %s, 'high',"
        " %s) RETURNING id",
        (attribute_of(value_type), value_type, retrieved, rejection_reason),
    ).fetchone()
    assert row is not None
    return int(row[0])


def with_its_payload(connection: psycopg.Connection, value_type: str, figure: int) -> None:
    connection.execute(PAYLOADS[value_type], {"id": figure})


def shares_summing_to(connection: psycopg.Connection, figure: int, total: Decimal) -> None:
    connection.execute(
        "INSERT INTO value_sharecomp (value_id, value_type, label, share)"
        " VALUES (%s, 'ShareComposition', 'English', 50), (%s, 'ShareComposition', 'German', %s)",
        (figure, figure, total - 50),
    )


def judge_now(connection: psycopg.Connection) -> None:
    """What COMMIT would decide, asked for now, in a savepoint a refusal leaves usable."""
    with connection.transaction():
        connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
        connection.execute("SET CONSTRAINTS ALL DEFERRED")


@pytest.mark.parametrize("value_type", PAYLOADS)
def test_an_accepted_figure_without_its_payload_is_refused(
    rolled_back: psycopg.Connection, value_type: str
) -> None:
    figure = a_figure(rolled_back, value_type)

    with pytest.raises(errors.CheckViolation, match=f"value {figure} is an accepted {value_type}"):
        judge_now(rolled_back)


@pytest.mark.parametrize("value_type", PAYLOADS)
def test_an_accepted_figure_with_its_payload_is_stored(
    rolled_back: psycopg.Connection, value_type: str
) -> None:
    with_its_payload(rolled_back, value_type, a_figure(rolled_back, value_type))

    judge_now(rolled_back)


def test_a_rejected_figure_may_be_its_parent_row_alone(rolled_back: psycopg.Connection) -> None:
    a_figure(rolled_back, "Quantity", rejection_reason="the unit was not the catalog's")

    judge_now(rolled_back)


@pytest.mark.parametrize("rejection_reason", [None, "a category was missing"])
@pytest.mark.parametrize(
    ("total", "refused"),
    [
        pytest.param(100 + SHARE_SUM_TOLERANCE, False, id="tolerance above"),
        pytest.param(100 - SHARE_SUM_TOLERANCE, False, id="tolerance below"),
        pytest.param(100 + SHARE_SUM_TOLERANCE + Decimal("0.01"), True, id="past it above"),
        pytest.param(100 - SHARE_SUM_TOLERANCE - Decimal("0.01"), True, id="past it below"),
        pytest.param(Decimal(80), True, id="a category missing"),
    ],
)
def test_a_composition_sums_to_100_within_the_domains_tolerance_accepted_or_rejected(
    rolled_back: psycopg.Connection, total: Decimal, refused: bool, rejection_reason: str | None
) -> None:
    figure = a_figure(rolled_back, "ShareComposition", rejection_reason=rejection_reason)
    shares_summing_to(rolled_back, figure, total)

    if refused:
        with pytest.raises(errors.CheckViolation, match=f"value {figure} is a share composition"):
            judge_now(rolled_back)
    else:
        judge_now(rolled_back)


@pytest.mark.parametrize("value_type", PAYLOADS)
def test_deleting_an_accepted_figures_payload_is_refused(
    rolled_back: psycopg.Connection, value_type: str
) -> None:
    figure = a_figure(rolled_back, value_type)
    with_its_payload(rolled_back, value_type, figure)
    judge_now(rolled_back)

    rolled_back.execute(f"DELETE FROM {PAYLOAD_TABLES[value_type]} WHERE value_id = %s", (figure,))

    with pytest.raises(errors.CheckViolation, match=f"value {figure} is an accepted {value_type}"):
        judge_now(rolled_back)


def test_deleting_one_label_of_several_leaves_the_figure_complete(
    rolled_back: psycopg.Connection,
) -> None:
    figure = a_figure(rolled_back, "LabelSet")
    with_its_payload(rolled_back, "LabelSet", figure)
    judge_now(rolled_back)

    rolled_back.execute(
        "DELETE FROM value_labelset WHERE value_id = %s AND label = 'Csa'", (figure,)
    )

    judge_now(rolled_back)


def test_deleting_a_figure_with_its_payload_in_one_transaction_is_allowed(
    rolled_back: psycopg.Connection,
) -> None:
    """The shape of the rollbacks of `0470`, `0488` and `0489`: payload first, then the figure."""
    figure = a_figure(rolled_back, "Quantity")
    with_its_payload(rolled_back, "Quantity", figure)
    judge_now(rolled_back)

    rolled_back.execute("DELETE FROM value_quantity WHERE value_id = %s", (figure,))
    rolled_back.execute("DELETE FROM value WHERE id = %s", (figure,))

    judge_now(rolled_back)


def test_moving_a_payload_to_another_figure_leaves_the_first_incomplete(
    rolled_back: psycopg.Connection,
) -> None:
    first = a_figure(rolled_back, "Quantity")
    with_its_payload(rolled_back, "Quantity", first)
    second = a_figure(
        rolled_back,
        "Quantity",
        rejection_reason="awaiting its figure",
        retrieved="2026-10-02T10:00:00Z",
    )
    judge_now(rolled_back)

    rolled_back.execute(
        "UPDATE value_quantity SET value_id = %s WHERE value_id = %s", (second, first)
    )

    with pytest.raises(errors.CheckViolation, match=f"value {first} is an accepted Quantity"):
        judge_now(rolled_back)


def test_re_accepting_a_rejected_figure_without_a_payload_is_refused(
    rolled_back: psycopg.Connection,
) -> None:
    """The shape of `0473`'s rollback, which sets `rejection_reason` back to null."""
    figure = a_figure(rolled_back, "Quantity", rejection_reason="dated the day it was fetched")
    judge_now(rolled_back)

    rolled_back.execute("UPDATE value SET rejection_reason = NULL WHERE id = %s", (figure,))

    with pytest.raises(errors.CheckViolation, match=f"value {figure} is an accepted Quantity"):
        judge_now(rolled_back)


# --- the migration itself -------------------------------------------------------------------


def run(connection: psycopg.Connection, file_name: str) -> None:
    _directives, _comment, statements = read_sql_migration(str(MIGRATIONS / file_name))
    for statement in statements:
        connection.execute(statement)


def installed(connection: psycopg.Connection) -> tuple[set[str], int]:
    """The functions 0519 adds that exist, and how many triggers call one of them."""
    functions = {
        name
        for (name,) in connection.execute(
            "SELECT proname FROM pg_proc WHERE proname = ANY(%s)", (list(FUNCTIONS),)
        ).fetchall()
    }
    row = connection.execute(
        "SELECT count(*) FROM pg_trigger AS t JOIN pg_proc AS p ON p.oid = t.tgfoid"
        " WHERE p.proname = ANY(%s)",
        (list(FUNCTIONS),),
    ).fetchone()
    assert row is not None
    return functions, int(row[0])


def test_a_stored_figure_breaking_either_rule_stops_the_migration_and_is_named(
    rolled_back: psycopg.Connection,
) -> None:
    run(rolled_back, f"{MIGRATION}.rollback.sql")
    without_payload = a_figure(rolled_back, "Index")
    off_by_twenty = a_figure(rolled_back, "ShareComposition", rejection_reason="incomplete")
    shares_summing_to(rolled_back, off_by_twenty, Decimal(80))

    with pytest.raises(errors.RaiseException) as refusal, rolled_back.transaction():
        run(rolled_back, f"{MIGRATION}.sql")

    message = str(refusal.value)
    assert f"1 accepted Index figure(s) with no payload (value {without_payload})" in message
    assert f"value {off_by_twenty} sums to 80" in message
    assert installed(rolled_back) == (set(), 0), "the refusal left a trigger behind"


def test_the_rollback_drops_what_the_migration_added_and_the_migration_restores_it(
    rolled_back: psycopg.Connection,
) -> None:
    assert installed(rolled_back) == (FUNCTIONS, 12)

    run(rolled_back, f"{MIGRATION}.rollback.sql")
    assert installed(rolled_back) == (set(), 0)

    run(rolled_back, f"{MIGRATION}.sql")
    assert installed(rolled_back) == (FUNCTIONS, 12)
