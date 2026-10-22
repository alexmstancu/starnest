"""What a rollback meets when the backend is still writing (BE-A1).

`make rollback` takes a backup and then runs; nothing stops the backend serving requests while it
does. So a rollback that refuses over recorded history, or copies rows to put them back, decides
on a read that a concurrent write can make stale. Each test here holds a real write open on one
connection, starts the real rollback on another, and commits the write only once the rollback
is waiting for it -- the interleaving that used to slip between the read and the act.

**The rollback runs as yoyo runs it** -- one transaction, each statement in a savepoint of its
own -- and is always undone afterwards, so the session's database is never actually rolled back.
Its statements meet the current schema rather than the one each migration reversed; what is
under test is the lock taken before the read, and that reads the same tables either way.
"""

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"

#: Long enough for a loaded machine, short enough that a lock nobody releases fails the test
#: rather than hanging the suite.
PATIENCE_SECONDS = 10

Probe = tuple[str, tuple[Any, ...]]


def statements_of(migration: str) -> list[str]:
    """A rollback's statements in the order yoyo runs them, split by yoyo's own parser."""
    _directives, _leading_comment, statements = read_sql_migration(
        str(MIGRATIONS / f"{migration}.rollback.sql")
    )
    return statements


async def roll_back_and_undo(
    url: str, migration: str, started: asyncio.Future[int], probe: Probe | None
) -> list[tuple[Any, ...]]:
    """Runs a rollback as yoyo does, reads `probe` before it ends, and always rolls it back."""
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as connection:
        await connection.execute("SET lock_timeout = '10s'")
        started.set_result(connection.info.backend_pid)
        async with connection.transaction(force_rollback=True):
            for statement in statements_of(migration):
                async with connection.transaction():
                    await connection.execute(statement)
            if probe is None:
                return []
            query, parameters = probe
            return await (await connection.execute(query, parameters)).fetchall()


async def waits_for_a_lock(url: str, pid: int) -> bool:
    """Whether backend `pid` comes to wait on a lock it asked for and was not granted."""
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as observer:
        for _ in range(PATIENCE_SECONDS * 50):
            waiting = await (
                await observer.execute(
                    "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = %s AND NOT granted)",
                    (pid,),
                )
            ).fetchone()
            if waiting is not None and waiting[0]:
                return True
            await asyncio.sleep(0.02)
    return False


async def race(
    url: str, migration: str, writer: psycopg.AsyncConnection, probe: Probe | None = None
) -> list[tuple[Any, ...]] | psycopg.Error:
    """Starts the rollback while `writer` holds a write open, commits that write once the
    rollback is waiting for it, and returns what the rollback came to: the rows `probe` read
    inside it, or the error it ended on."""
    started: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    rollback = asyncio.create_task(roll_back_and_undo(url, migration, started, probe))
    try:
        waited = await waits_for_a_lock(url, await asyncio.wait_for(started, PATIENCE_SECONDS))
        await writer.commit()
        assert waited, "the rollback never waited for the write in flight, so this proves nothing"
        try:
            return await asyncio.wait_for(rollback, PATIENCE_SECONDS * 2)
        except psycopg.Error as error:
            return error
    finally:
        await asyncio.wait({rollback}, timeout=PATIENCE_SECONDS * 2)
        if rollback.done() and not rollback.cancelled():
            rollback.exception()


@dataclass(frozen=True)
class Refusal:
    """A rollback that refuses over recorded history, and a row of that history to race it."""

    migration: str
    write: str
    undo: str
    says: str


def a_figure_for(attribute: str) -> str:
    return (
        "INSERT INTO value (candidate, attribute, value_type, data_source, "
        "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
        f"VALUES ('country.romania', '{attribute}', 'Quantity', 'oecd', '2022-01-01', "
        "'2022-12-31', now(), 'high')"
    )


REFUSALS = (
    Refusal(
        migration="0503-gate-research-spend-is-ledgered",
        write="INSERT INTO match_rule_research_spend "
        "(match_rule, candidate, data_source, llm_call_count, cost_eur) "
        "VALUES ('li_eea_quota', 'country.liechtenstein', 'llm', 1, 0.05)",
        undo="DELETE FROM match_rule_research_spend WHERE match_rule = 'li_eea_quota'",
        says="cannot roll back 0503: 1 billed research call",
    ),
    Refusal(
        migration="0493-liechtensteins-quota-is-a-gate",
        write="INSERT INTO match_rule_result "
        "(match_rule, candidate, match_result, data_source, retrieval_date) "
        "VALUES ('li_eea_quota', 'country.liechtenstein', 'not_matching', 'manual', now())",
        undo="DELETE FROM match_rule_result WHERE match_rule = 'li_eea_quota'",
        says="cannot roll back 0493: 1 answer",
    ),
    Refusal(
        migration="0492-child-benefit-is-a-share-of-the-wage",
        write=a_figure_for("country.child_benefit_policy"),
        undo="DELETE FROM value WHERE attribute = 'country.child_benefit_policy'",
        says="cannot roll back 0492: 1 figures are stored",
    ),
    Refusal(
        migration="0478-school-quality-is-a-quantity",
        write=a_figure_for("country.school_system_quality"),
        undo="DELETE FROM value WHERE attribute = 'country.school_system_quality'",
        says="cannot roll back 0478: 1 figures are stored",
    ),
)


@pytest.mark.parametrize("refusal", REFUSALS, ids=lambda refusal: refusal.migration[:4])
async def test_a_row_committed_while_a_rollback_waits_meets_its_refusal(
    refusal: Refusal, database_url: str
) -> None:
    """**The refusal is what a row landing mid-rollback meets.** Unlocked, `0503` counted no
    billed call and dropped the ledger with the one committed after the count; `0493`, `0492`
    and `0478` met a raw foreign-key error in place of the refusal that names the remedy.
    """
    async with await psycopg.AsyncConnection.connect(database_url) as writer:
        try:
            await writer.execute(refusal.write)
            outcome = await race(database_url, refusal.migration, writer)
        finally:
            await writer.rollback()
            await writer.execute(refusal.undo)
            await writer.commit()

    assert isinstance(outcome, errors.RaiseException), (
        f"{refusal.migration} should have refused over the row committed while it waited, "
        f"and came to {outcome!r}"
    )
    assert refusal.says in str(outcome)


#: The set the edit lands in. Both shipped sets judge every attribute below.
EDITED_SET = "local_employment"

#: `0444` lifts rows too, but of `house_price_to_income_ratio`, which `0488` retired along with
#: its criteria: at the head there is nothing for its copy to hold, and so nothing to race. Its
#: lock still matters on a real way back, where `0488`'s rollback restores those rows first;
#: `test_migration_hygiene` holds its text to the same rule.
LIFTS = (
    ("0478-school-quality-is-a-quantity", "country.school_system_quality"),
    ("0492-child-benefit-is-a-share-of-the-wage", "country.child_benefit_policy"),
)


@pytest.mark.parametrize(("migration", "attribute"), LIFTS, ids=[lift[0][:4] for lift in LIFTS])
async def test_an_edit_committed_while_a_rollback_waits_is_carried_through_it(
    migration: str, attribute: str, database_url: str
) -> None:
    """**An edit is copied, never overwritten by an older copy.** These rollbacks lift a
    criterion's rows out, delete them and insert the copy back. Unlocked, an edit committed
    after the copy was deleted with the rest and replaced by the copy taken before it.

    The edit here updates its row in place, which makes that loss certain without the lock.
    The application writes a set by deleting and re-inserting its rows, which the unlocked
    rollback met either the same way or with a raw foreign-key error, depending on when the
    edit committed.
    """
    where = "WHERE criteria_set = %s AND attribute = %s"
    async with await psycopg.AsyncConnection.connect(database_url) as writer:
        stored = await (
            await writer.execute(
                f"SELECT weight_locked FROM criterion {where}", (EDITED_SET, attribute)
            )
        ).fetchone()
        assert stored is not None, f"{EDITED_SET} has no criterion on {attribute} to edit"
        try:
            await writer.execute(
                f"UPDATE criterion SET weight_locked = NOT weight_locked {where}",
                (EDITED_SET, attribute),
            )
            outcome = await race(
                database_url,
                migration,
                writer,
                probe=(f"SELECT weight_locked FROM criterion {where}", (EDITED_SET, attribute)),
            )
        finally:
            await writer.rollback()
            await writer.execute(
                f"UPDATE criterion SET weight_locked = %s {where}",
                (stored[0], EDITED_SET, attribute),
            )
            await writer.commit()

    assert outcome == [(not stored[0],)], (
        f"{migration} should have carried the edit committed while it waited, "
        f"and came to {outcome!r}"
    )
