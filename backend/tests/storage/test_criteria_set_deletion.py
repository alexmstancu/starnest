"""A criteria set is deleted in place: it keeps every row it owns, and restoring it is one UPDATE.

PL-033 (UF-025): deleting a set was one multi-table DELETE, with no record and no way back. It
now sets `criteria_set.deleted_at` and touches nothing else (P1-27), so a restore clears one
column and is exact by construction -- the criteria with their rules, anchors and thresholds,
both kinds of lock, the pillar weights, the rule rows (a row whose flag is off included, which a
copy through the domain would drop) and even the generated criterion ids come back untouched
(map-C03 1.0).

Around it: an identifier is never reused (P1-28), a name belongs to one live set (PL-036), a name
taken while a set was deleted holds its restore off (P1-35), and one set is the default (P1-29).
"""

import ast
import asyncio
import contextlib
import inspect
import textwrap
from collections.abc import AsyncIterator, Awaitable, Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import AsyncConnectionPool
from yoyo.migrations import read_sql_migration

from starnest.criteria import (
    CriteriaSet,
    CriteriaSetExistsError,
    Criterion,
    Goal,
    NormalisationMethod,
    PillarWeight,
    UnknownCriteriaSetError,
)
from starnest.criteria.store import CriteriaSetNameTakenError
from starnest.data import ValueType
from starnest.storage import PostgresCriteriaStore

pytestmark = pytest.mark.storage

SHIPPED = "local_employment"
MINIMAL = "minimal"
COUNTRY = "country"
RESTORED = "restored_row_for_row"
RACED = "raced_by_a_deletion"
FIRST = "first_of_two"
SECOND = "second_of_two"

THE_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "storage"
    / "migrations"
    / "0508-criteria-sets-are-deleted-in-place-and-named-uniquely.sql"
)

OF_THE_SET = "criteria_set = %(criteria_set)s"
OF_ITS_CRITERIA = "criterion IN (SELECT id FROM criterion WHERE criteria_set = %(criteria_set)s)"

ROWS_A_SET_OWNS = {
    "criteria_set": "id = %(criteria_set)s",
    "pillar_weight": OF_THE_SET,
    "criterion": OF_THE_SET,
    "criteria_set_match_rule": OF_THE_SET,
    "criteria_set_compound_rule": OF_THE_SET,
    "criterion_scale_anchor": OF_ITS_CRITERIA,
    "criterion_threshold_range": OF_ITS_CRITERIA,
    "criterion_threshold_label": OF_ITS_CRITERIA,
    "criterion_threshold_boolean": OF_ITS_CRITERIA,
    "criterion_threshold_share": OF_ITS_CRITERIA,
}
"""Every table holding a set's rows, and how to find that set's rows in it (map-C03 1.0.1).

`test_these_are_every_table_hanging_off_a_set` holds this to the schema, so a child table added
later fails there until the snapshot covers it. A new *column* needs nothing: the snapshot is
`SELECT *`.
"""

NOT_PART_OF_A_SET = {
    "evaluation": "a saved ranking is a measurement that names the set it was computed with; it "
    "keeps naming a deleted one, which is why a set some ranking used can now be deleted",
}

NO_ATTRIBUTE_CAN_HOLD = {"criterion_threshold_boolean", "criterion_threshold_share"}
"""No attribute in the catalog is a `Boolean` or a `ShareComposition`, so no criterion can carry
these thresholds yet. They stay in the snapshot: the day one can, it is covered."""

REWRITES_WITHOUT_THE_LOCK = {
    "create_criteria_set": "a new set: inserting its row is refused for an id any set holds, "
    "live or deleted, so there is no deleted set for it to write into",
    "_purge": "tests and tooling only: it destroys the set, deleted or not, so it takes the "
    "lock that reaches a deleted set, `lock_criteria_set_live_or_deleted`",
}
"""Store methods that clear or write a set's rows without taking the live set's lock first."""

A_ROW_OF_EVERY_KIND = (
    "UPDATE pillar_weight SET weight_locked = true"
    " WHERE criteria_set = %(criteria_set)s AND pillar = 'housing'",
    "UPDATE criterion SET weight_locked = true"
    " WHERE criteria_set = %(criteria_set)s AND attribute = 'country.housing_cost_overburden_rate'",
    "UPDATE criterion SET is_scored = false"
    " WHERE criteria_set = %(criteria_set)s AND attribute = 'country.broadband_coverage'",
    "UPDATE criterion_scale_anchor SET label = 'content' WHERE score = 100 AND criterion ="
    " (SELECT id FROM criterion WHERE criteria_set = %(criteria_set)s"
    "  AND attribute = 'country.life_satisfaction')",
    "INSERT INTO criterion_threshold_range (criterion, value_type, min_value, max_value)"
    " SELECT id, value_type, NULL, 30 FROM criterion"
    " WHERE criteria_set = %(criteria_set)s AND attribute = 'country.housing_cost_overburden_rate'",
    "INSERT INTO criterion_threshold_label (criterion, value_type, label, containment_rule)"
    " SELECT id, value_type, 'Cfb', 'must_contain' FROM criterion"
    " WHERE criteria_set = %(criteria_set)s AND attribute = 'country.climate_zone'",
    "INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced)"
    " VALUES (%(criteria_set)s, 'uk_skilled_worker', true)"
    " ON CONFLICT (criteria_set, match_rule) DO UPDATE SET is_enforced = true",
    "INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced)"
    " VALUES (%(criteria_set)s, 'li_eea_quota', false)"
    " ON CONFLICT (criteria_set, match_rule) DO UPDATE SET is_enforced = false",
    "INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied)"
    " VALUES (%(criteria_set)s, 'cheap_but_taxed', true)"
    " ON CONFLICT (criteria_set, compound_rule) DO UPDATE SET is_applied = true",
    "INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied)"
    " VALUES (%(criteria_set)s, 'mild_now_brutal_later', false)"
    " ON CONFLICT (criteria_set, compound_rule) DO UPDATE SET is_applied = false",
)
"""Both kinds of lock, a criterion left out of the score, a band label, two threshold shapes, and
rule rows on and off. **The off rows are written by SQL**: a row whose flag is false reads as off
and the domain never writes one, so a restore rebuilt from a domain read would drop it."""


@pytest.fixture
def criteria(pool: AsyncConnectionPool) -> PostgresCriteriaStore:
    return PostgresCriteriaStore(pool)


@pytest.fixture
async def make(
    criteria: PostgresCriteriaStore,
) -> AsyncIterator[Callable[[CriteriaSet], Awaitable[None]]]:
    """Creates a set for one test and purges it afterwards, live, deleted or never written."""
    made: list[str] = []

    async def create(criteria_set: CriteriaSet) -> None:
        made.append(str(criteria_set.id))
        await criteria.create_criteria_set(criteria_set)

    yield create
    for identifier in made:
        with contextlib.suppress(UnknownCriteriaSetError):
            await criteria.purge_criteria_set(identifier)


def _a_set(identifier: str, *, name: str | None = None, locked: bool = False) -> CriteriaSet:
    """One criterion in one pillar, which is the smallest set whose weights sum."""
    return CriteriaSet(
        id=identifier,
        name=name or identifier,
        criteria=(
            Criterion(
                criteria_set=identifier,
                attribute="country.life_satisfaction",
                pillar="culture",
                value_type=ValueType.QUANTITY,
                weight=Decimal(100),
                goal=Goal.MAXIMISE,
                normalisation_method=NormalisationMethod.PERCENTILE,
                weight_locked=locked,
            ),
        ),
        pillar_weights=(
            PillarWeight(
                pillar="culture", level=COUNTRY, weight=Decimal(100), weight_locked=locked
            ),
        ),
    )


async def _give_it_a_row_of_every_kind(pool: AsyncConnectionPool, criteria_set: str) -> None:
    async with pool.connection() as connection:
        for statement in A_ROW_OF_EVERY_KIND:
            written = await connection.execute(statement, {"criteria_set": criteria_set})
            assert written.rowcount == 1, f"wrote nothing, so proves nothing: {statement}"


async def _rows_owned_by(
    pool: AsyncConnectionPool, criteria_set: str
) -> dict[str, list[tuple[Any, ...]]]:
    """`SELECT *` of every table in `ROWS_A_SET_OWNS`, for one set, in a stable order."""
    owned: dict[str, list[tuple[Any, ...]]] = {}
    async with pool.connection() as connection:
        for table, owned_by_it in ROWS_A_SET_OWNS.items():
            rows = await (
                await connection.execute(
                    f"SELECT * FROM {table} WHERE {owned_by_it}", {"criteria_set": criteria_set}
                )
            ).fetchall()
            owned[table] = sorted((tuple(row) for row in rows), key=repr)
    return owned


class TestDeletingInPlace:
    async def test_a_deleted_set_comes_back_row_for_row(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
    ) -> None:
        """T33-B1. **Exact by construction, and asserted row by row**, generated ids included.

        A restore that rebuilt the set from what the domain reads would renumber every
        criterion and drop the rule rows whose flag is off; a delete that destroyed the rows
        would leave nothing to restore.
        """
        shipped = await criteria.read_criteria_set(SHIPPED)
        await make(shipped.duplicated_as(RESTORED, "Restored row for row"))
        await _give_it_a_row_of_every_kind(pool, RESTORED)
        before = await _rows_owned_by(pool, RESTORED)
        as_read = await criteria.read_criteria_set(RESTORED)
        assert {table for table, rows in before.items() if not rows} == NO_ATTRIBUTE_CAN_HOLD
        assert (RESTORED, "li_eea_quota", False) in before["criteria_set_match_rule"]
        assert (RESTORED, "mild_now_brutal_later", False) in before["criteria_set_compound_rule"]

        await criteria.discard_criteria_set(RESTORED)

        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set(RESTORED)
        assert RESTORED not in {s.id for s in await criteria.read_criteria_set_summaries()}

        restored = await criteria.restore_criteria_set(RESTORED)

        assert await _rows_owned_by(pool, RESTORED) == before
        assert restored == as_read == await criteria.read_criteria_set(RESTORED)

    async def test_these_are_every_table_hanging_off_a_set(self, pool: AsyncConnectionPool) -> None:
        """T33-B2 (G2). The snapshot above is only exact if it names every table a set owns.

        Walked from `criteria_set` through every foreign key, transitively, stopping at a saved
        ranking: that is a measurement naming the set, not a part of it.
        """
        async with pool.connection() as connection:
            references = await (
                await connection.execute(
                    "SELECT conrelid::regclass::text, confrelid::regclass::text"
                    " FROM pg_constraint WHERE contype = 'f'"
                )
            ).fetchall()
        reached, frontier = {"criteria_set"}, ["criteria_set"]
        while frontier:
            parent = frontier.pop()
            for child, referenced in references:
                if referenced == parent and child not in reached | set(NOT_PART_OF_A_SET):
                    reached.add(child)
                    frontier.append(child)

        assert reached == set(ROWS_A_SET_OWNS)

    async def test_a_deleted_set_is_neither_read_nor_written_nor_deleted_again(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        """Every read and every edit sees live sets only (map-C03 2.1)."""
        await make(_a_set(FIRST))
        await criteria.discard_criteria_set(FIRST)

        with pytest.raises(UnknownCriteriaSetError, match="no criteria set"):
            await criteria.read_criteria_set(FIRST, level=COUNTRY)
        with pytest.raises(UnknownCriteriaSetError, match="to edit"):
            await criteria.edit_criteria_set(FIRST, lambda current: current)
        with pytest.raises(UnknownCriteriaSetError, match="to replace"):
            await criteria.replace_criteria_set(_a_set(FIRST))
        with pytest.raises(UnknownCriteriaSetError, match="to delete"):
            await criteria.discard_criteria_set(FIRST)

    async def test_deleting_a_set_that_does_not_exist_is_refused(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        with pytest.raises(UnknownCriteriaSetError, match="to delete"):
            await criteria.discard_criteria_set("never_created")

    async def test_restoring_is_idempotent_and_needs_a_set_that_was_made(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        """Restoring a live set changes nothing; an id nothing ever held is reported."""
        await make(_a_set(FIRST))

        assert await criteria.restore_criteria_set(FIRST) == await criteria.read_criteria_set(FIRST)
        with pytest.raises(UnknownCriteriaSetError, match="to restore"):
            await criteria.restore_criteria_set("never_created")


class TestADeletionRacingAnEdit:
    """T33-B3. A set is locked by its row, and a deleted row is not one an edit can lock."""

    async def test_a_deletion_waits_for_an_edit_in_flight_and_then_wins(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
        wait_until_blocked: Callable[..., Awaitable[int]],
    ) -> None:
        """The edit lands first and is kept, then the set is deleted -- with the edit in it."""
        await make(_a_set(RACED))
        async with pool.connection() as editor:
            await criteria._queries.lock_criteria_set(editor, criteria_set=RACED)
            await criteria._queries.update_criteria_set_name(
                editor, criteria_set=RACED, name="Renamed while deleted"
            )
            deletion = asyncio.create_task(criteria.discard_criteria_set(RACED))
            await wait_until_blocked(deletion, on={editor.info.backend_pid})
        await deletion

        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set(RACED)
        assert (await criteria.restore_criteria_set(RACED)).name == "Renamed while deleted"

    async def test_an_edit_queued_behind_a_deletion_finds_no_set(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
        wait_until_blocked: Callable[..., Awaitable[int]],
    ) -> None:
        """The lock re-reads the row once the deletion commits, and a deleted row is no set: the
        edit is refused rather than written into a set nobody can see."""
        await make(_a_set(RACED))
        async with pool.connection() as deleter:
            await criteria._queries.discard_criteria_set(deleter, criteria_set=RACED)
            edit = asyncio.create_task(
                criteria.edit_criteria_set(
                    RACED, lambda current: current.model_copy(update={"name": "Written too late"})
                )
            )
            await wait_until_blocked(edit, on={deleter.info.backend_pid})

        with pytest.raises(UnknownCriteriaSetError, match="to edit"):
            await edit
        assert (await criteria.restore_criteria_set(RACED)).name == RACED

    async def test_a_replacement_queued_behind_a_deletion_finds_no_set(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
        wait_until_blocked: Callable[..., Awaitable[int]],
    ) -> None:
        """**A replacement locks the live set first, as an edit does** (review of 957b3f6).

        Unlocked, it read the set live, met the deletion only at its name -- which it then skipped
        -- and still rewrote every row the deleted set owns: renumbered criteria, flipped locks, in
        a set nobody could see, so restoring it was no longer exact (P1-27).
        """
        await make(_a_set(RACED))
        before = await _rows_owned_by(pool, RACED)
        async with pool.connection() as deleter:
            await criteria._queries.discard_criteria_set(deleter, criteria_set=RACED)
            replacement = asyncio.create_task(
                criteria.replace_criteria_set(_a_set(RACED, name="Written too late", locked=True))
            )
            await wait_until_blocked(replacement, on={deleter.info.backend_pid})

        with pytest.raises(UnknownCriteriaSetError, match="to replace"):
            await replacement
        await criteria.restore_criteria_set(RACED)
        assert await _rows_owned_by(pool, RACED) == before

    async def test_a_restore_waiting_on_an_edit_answers_with_the_set_the_edit_left(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
        wait_until_blocked: Callable[..., Awaitable[int]],
    ) -> None:
        """**A restore locks the set before it reads it** (review of f6d1f01).

        Restoring a live set is idempotent, so it can meet an edit in flight. Read before the
        lock, it answered with the set as it stood before the edit committed: a body no read
        gives once the request returns.
        """
        await make(_a_set(RACED))
        async with pool.connection() as editor:
            await criteria._queries.lock_criteria_set(editor, criteria_set=RACED)
            await criteria._queries.update_criteria_set_name(
                editor, criteria_set=RACED, name="Renamed meanwhile"
            )
            restore = asyncio.create_task(criteria.restore_criteria_set(RACED))
            await wait_until_blocked(restore, on={editor.info.backend_pid})

        restored = await restore
        assert restored.name == "Renamed meanwhile"
        assert restored == await criteria.read_criteria_set(RACED)

    async def test_a_purge_waiting_on_an_edit_destroys_the_set_with_the_edit(
        self,
        criteria: PostgresCriteriaStore,
        make: Callable[[CriteriaSet], Awaitable[None]],
        pool: AsyncConnectionPool,
        wait_until_blocked: Callable[..., Awaitable[int]],
    ) -> None:
        """**A purge locks the set before it clears it** (review of f6d1f01).

        Unlocked, it cleared the rows it could see and then waited on the set row, so a row the
        edit wrote meanwhile was left behind -- and the purge was refused as though a saved
        evaluation held the set, which none did.
        """
        await make(_a_set(RACED))
        async with pool.connection() as editor:
            await criteria._queries.lock_criteria_set(editor, criteria_set=RACED)
            purge = asyncio.create_task(criteria.purge_criteria_set(RACED))
            await wait_until_blocked(purge, on={editor.info.backend_pid})
            await editor.execute(
                "INSERT INTO pillar_weight (criteria_set, pillar, level, weight)"
                " VALUES (%s, 'housing', %s, 0)",
                (RACED, COUNTRY),
            )

        await purge
        assert await _rows_owned_by(pool, RACED) == {table: [] for table in ROWS_A_SET_OWNS}

    def test_every_rewrite_of_a_sets_rows_locks_the_live_set_first(self) -> None:
        """The races above as a rule over the store's own code, so a write path added later
        cannot rewrite a deleted set's rows: one that clears or writes them takes
        `lock_criteria_set` before any other query, or is listed here with the reason."""
        rewriting = {"delete_criteria_set_contents", "_write_contents"}
        unlocked = set()
        for method in ast.walk(
            ast.parse(textwrap.dedent(inspect.getsource(PostgresCriteriaStore)))
        ):
            if not isinstance(method, ast.AsyncFunctionDef):
                continue
            calls = sorted(
                (node for node in ast.walk(method) if isinstance(node, ast.Call)),
                key=lambda node: (node.lineno, node.col_offset),
            )
            called = [call.func.attr for call in calls if isinstance(call.func, ast.Attribute)]
            if rewriting & set(called) and called[0] != "lock_criteria_set":
                unlocked.add(method.name)

        assert unlocked == set(REWRITES_WITHOUT_THE_LOCK)


class TestIdentifiersAndNames:
    async def test_a_deleted_sets_identifier_is_never_given_to_another(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        """P1-28: a deleted set keeps its id, so a restore can only ever bring back that set."""
        await make(_a_set(FIRST))
        await criteria.discard_criteria_set(FIRST)

        with pytest.raises(CriteriaSetExistsError, match="deleted") as refused:
            await criteria.create_criteria_set(_a_set(FIRST, name="Somebody else's"))
        assert type(refused.value) is CriteriaSetExistsError

    async def test_a_new_set_may_not_take_a_live_sets_name_in_any_case_or_spacing(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        """PL-036, refused as a name rather than as an identifier, and nothing is written."""
        await make(_a_set(FIRST, name="Partner"))

        with pytest.raises(CriteriaSetNameTakenError, match="'  PARTNER '") as refused:
            await make(_a_set(SECOND, name="  PARTNER "))

        assert refused.value.name == "  PARTNER "
        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set(SECOND)

    async def test_a_rename_to_a_live_sets_name_is_refused_and_changes_nothing(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        await make(_a_set(FIRST, name="Partner"))
        await make(_a_set(SECOND, name="Alex"))

        with pytest.raises(CriteriaSetNameTakenError, match="'partner'"):
            await criteria.edit_criteria_set(
                SECOND, lambda current: current.model_copy(update={"name": "partner"})
            )

        assert (await criteria.read_criteria_set(SECOND)).name == "Alex"

    async def test_a_name_taken_while_a_set_was_deleted_holds_its_restore_off(
        self, criteria: PostgresCriteriaStore, make: Callable[[CriteriaSet], Awaitable[None]]
    ) -> None:
        """P1-35. A deleted set holds no name, so another may take it; restoring the first then
        is refused, naming the set and the name, and leaves it deleted."""
        await make(_a_set(FIRST, name="Partner"))
        await criteria.discard_criteria_set(FIRST)
        await make(_a_set(SECOND, name="partner"))

        with pytest.raises(CriteriaSetNameTakenError, match=f"'{FIRST}'.*'Partner'") as refused:
            await criteria.restore_criteria_set(FIRST)

        assert refused.value.name == "Partner"
        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set(FIRST)


class TestTheMigration:
    def test_one_set_is_the_default_and_a_second_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """T34-B4 (P1-29): the default is a flag on the set row, and there is at most one."""
        defaults = connection.execute("SELECT id FROM criteria_set WHERE is_default").fetchall()
        assert defaults == [(SHIPPED,)]

        with pytest.raises(errors.UniqueViolation, match="criteria_set_one_default"):
            connection.execute(
                "UPDATE criteria_set SET is_default = true WHERE id = %s", (MINIMAL,)
            )

    def test_its_name_check_names_every_set_that_would_clash(
        self, connection: psycopg.Connection
    ) -> None:
        """T36-B4, replayed. Two live sets sharing a name ignoring case and surrounding spaces
        would make the unique index fail with a driver error naming neither, so the migration
        checks first and names both. The index is dropped inside this test's transaction, which
        is rolled back, so the clash can be built at all."""
        connection.execute("DROP INDEX criteria_set_name_is_unique")
        connection.execute(
            "INSERT INTO criteria_set (id, name) VALUES ('remote_only_again', ' remote ONLY')"
        )
        _directives, _leading_comment, statements = read_sql_migration(str(THE_MIGRATION))
        the_check = statements[: 1 + next(i for i, s in enumerate(statements) if "RAISE" in s)]

        with pytest.raises(errors.RaiseException) as refused:
            for statement in the_check:
                connection.execute(statement)

        assert "'Remote only', ' remote ONLY' (remote_only, remote_only_again)" in str(
            refused.value
        )
