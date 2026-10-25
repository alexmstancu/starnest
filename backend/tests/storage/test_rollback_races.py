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
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import namedtuple_row
from psycopg_pool import AsyncConnectionPool
from yoyo.migrations import read_sql_migration

from starnest.storage.criteria_store import PostgresCriteriaStore, _criteria_set_from

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
    url: str,
    migrations: tuple[str, ...],
    started: asyncio.Future[int],
    probe: Probe | None,
) -> list[tuple[Any, ...]]:
    """Runs rollbacks in order as yoyo does, reads `probe` before they end, and always rolls
    them back."""
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as connection:
        await connection.execute("SET lock_timeout = '10s'")
        started.set_result(connection.info.backend_pid)
        async with connection.transaction(force_rollback=True):
            for statement in (s for migration in migrations for s in statements_of(migration)):
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
    url: str,
    migration: str,
    writer: psycopg.AsyncConnection,
    probe: Probe | None = None,
    *,
    before: tuple[str, ...] = (),
) -> list[tuple[Any, ...]] | psycopg.Error:
    """Starts the rollback -- after the rollbacks `before` it, in the same transaction, as a
    descending `make rollback` reaches it -- while `writer` holds a write open, commits that
    write once the rollback is waiting for it, and returns what the rollback came to: the rows
    `probe` read inside it, or the error it ended on."""
    started: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    rollback = asyncio.create_task(roll_back_and_undo(url, (*before, migration), started, probe))
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
    #: Rollbacks that run first, where the head holds what one of them undoes.
    before: tuple[str, ...] = ()
    #: Tells apart two refusals of one rollback.
    case: str = ""


def a_figure_for(attribute: str) -> str:
    """An accepted figure and its payload, written together: `0519` refuses either alone."""
    return (
        "DO $$ DECLARE figure bigint; BEGIN "
        "INSERT INTO value (candidate, attribute, value_type, data_source, "
        "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
        f"VALUES ('country.romania', '{attribute}', 'Quantity', 'oecd', '2022-01-01', "
        "'2022-12-31', now(), 'high') RETURNING id INTO figure; "
        "INSERT INTO value_quantity (value_id, value_type, magnitude, unit) "
        "SELECT figure, 'Quantity', 1, unit FROM attribute_quantity_parameter "
        f"WHERE attribute = '{attribute}'; END $$"
    )


def a_figure_undone(attribute: str) -> str:
    """Its payload first, then the figure, in one transaction."""
    return (
        "DO $$ BEGIN "
        "DELETE FROM value_quantity WHERE value_id IN "
        f"(SELECT id FROM value WHERE attribute = '{attribute}'); "
        f"DELETE FROM value WHERE attribute = '{attribute}'; END $$"
    )


ANSWERS_UNDONE = (
    "DO $$ BEGIN "
    "DELETE FROM match_rule_result WHERE match_rule = 'li_eea_quota'; "
    "DELETE FROM match_rule_answer WHERE match_rule = 'li_eea_quota'; END $$"
)

#: Marks every row the history cases below write, so each undo finds exactly its own.
HISTORY = "TL-N2 race row"


def a_saved_ranking(*then: str) -> str:
    """A saved evaluation, then `then` with its id as `ranking`, in one block so the parent
    exists before its children."""
    return (
        "DO $$ DECLARE ranking bigint; result bigint; figure bigint; BEGIN "
        "INSERT INTO evaluation (criteria_set, level, computed_at, score_scale_max, note) "
        f"VALUES ('minimal', 'country', now(), 100, '{HISTORY}') RETURNING id INTO ranking; "
        + " ".join(then)
        + " END $$"
    )


A_FROZEN_CRITERION = (
    "INSERT INTO evaluation_criterion (evaluation, attribute, pillar, is_scored, weight, "
    "pillar_weight, goal, normalisation_method, blocks_if_missing, value_type, weight_locked) "
    "VALUES (ranking, 'country.homicide_rate', 'safety', true, 100, 10, 'minimise', "
    "'percentile', false, 'Quantity', true);"
)
A_RESULT = (
    "INSERT INTO candidate_result (evaluation, candidate, score, coverage, match_status, "
    "score_scale_max, level, coverage_high) VALUES (ranking, 'country.romania', 50, 90, "
    "'matching', 100, 'country', 50) RETURNING id INTO result;"
)
RANKING_UNDONE = (
    "DO $$ BEGIN "
    f"DELETE FROM evaluation WHERE note = '{HISTORY}'; "
    "DELETE FROM value_quantity WHERE value_id IN (SELECT id FROM value "
    "WHERE data_source = 'oecd' AND reference_period_start = '2021-01-01'); "
    f"DELETE FROM value WHERE data_source = 'oecd' AND reference_period_start = '2021-01-01'; "
    "END $$"
)


def a_run(*then: str, status: str = "completed", stop: str = "NULL") -> str:
    """A run, then `then` with its id as `run_id`."""
    return (
        "DO $$ DECLARE run_id bigint; BEGIN "
        "INSERT INTO data_acquisition_run "
        "(started_at, triggered_by, run_status, level, stop_requested_at) "
        f"VALUES (now(), '{HISTORY}', '{status}', 'country', {stop}) RETURNING id INTO run_id; "
        + " ".join(then)
        + " END $$"
    )


#: Romania's homicide rate as one of the run's items, so its evidence may name it (0513).
AN_ITEM = (
    "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate, level) "
    "VALUES (run_id, 'country.romania', 'country'); "
    "INSERT INTO data_acquisition_run_attribute (data_acquisition_run, attribute, level) "
    "VALUES (run_id, 'country.homicide_rate', 'country'); "
    "INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute) "
    "VALUES (run_id, 'country.romania', 'country.homicide_rate');"
)


RUN_UNDONE = (
    "DO $$ BEGIN "
    + " ".join(
        f"DELETE FROM {table} WHERE data_acquisition_run IN "
        f"(SELECT id FROM data_acquisition_run WHERE triggered_by = '{HISTORY}');"
        for table in (
            "data_acquisition_run_reuse",
            "data_acquisition_failure",
            "data_acquisition_run_item",
            "data_acquisition_run_candidate",
            "data_acquisition_run_attribute",
        )
    )
    + f" DELETE FROM data_acquisition_run WHERE triggered_by = '{HISTORY}'; END $$"
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
        # The live answer points at its version (0510), so the version is written first.
        write="DO $$ DECLARE version bigint; BEGIN "
        "INSERT INTO match_rule_answer "
        "(match_rule, candidate, match_result, data_source, retrieval_date) "
        "VALUES ('li_eea_quota', 'country.liechtenstein', 'not_matching', 'manual', now()) "
        "RETURNING id INTO version; "
        "INSERT INTO match_rule_result "
        "(match_rule, candidate, answer, match_result, data_source, retrieval_date) "
        "VALUES ('li_eea_quota', 'country.liechtenstein', version, 'not_matching', 'manual', "
        "now()); END $$",
        undo=ANSWERS_UNDONE,
        says="cannot roll back 0493: 1 answer",
    ),
    # A superseded gate answer is history 0510's rollback would drop (PL-143): a version that is
    # not its pair's live one.
    Refusal(
        migration="0510-a-gate-answer-is-kept-once-written",
        write="INSERT INTO match_rule_answer "
        "(match_rule, candidate, match_result, data_source, retrieval_date) "
        "VALUES ('li_eea_quota', 'country.liechtenstein', 'matching', 'manual', now())",
        undo=ANSWERS_UNDONE,
        says="cannot roll back 0510: 1 earlier gate answer(s)",
    ),
    Refusal(
        migration="0492-child-benefit-is-a-share-of-the-wage",
        write=a_figure_for("country.child_benefit_policy"),
        undo=a_figure_undone("country.child_benefit_policy"),
        says="cannot roll back 0492: 1 figures are stored",
    ),
    Refusal(
        migration="0478-school-quality-is-a-quantity",
        write=a_figure_for("country.school_system_quality"),
        undo=a_figure_undone("country.school_system_quality"),
        says="cannot roll back 0478: 1 figures are stored",
    ),
    # A gate another set still enforces: `0494`'s rollback disarms only `local_employment`'s, so
    # it runs first, as it does on the way down (P95).
    Refusal(
        migration="0493-liechtensteins-quota-is-a-gate",
        before=("0494-the-liechtenstein-quota-gate-is-armed",),
        case="enforced",
        # An enforced gate names its outcome since 0516; a gate's default is to rule out.
        write="INSERT INTO criteria_set_match_rule "
        "(criteria_set, match_rule, is_enforced, outcome) "
        "VALUES ('remote_only', 'li_eea_quota', true, 'not_matching')",
        undo="DELETE FROM criteria_set_match_rule "
        "WHERE criteria_set = 'remote_only' AND match_rule = 'li_eea_quota'",
        says="cannot roll back 0493: the li_eea_quota gate is still enforced by 1 criteria "
        "set(s) (remote_only)",
    ),
    # A person's anchor or matching threshold hangs off the criterion these lift (P95).
    Refusal(
        migration="0478-school-quality-is-a-quantity",
        case="anchored",
        write="INSERT INTO criterion_scale_anchor (criterion, input_value, score) "
        "SELECT id, 500, 100 FROM criterion WHERE criteria_set = 'remote_only' "
        "AND attribute = 'country.school_system_quality'",
        undo="DELETE FROM criterion_scale_anchor WHERE criterion IN (SELECT id FROM criterion "
        "WHERE attribute = 'country.school_system_quality')",
        says="cannot roll back 0478: 1 criteria on country.school_system_quality carry scale "
        "anchors or a matching threshold (sets: remote_only)",
    ),
    Refusal(
        migration="0492-child-benefit-is-a-share-of-the-wage",
        case="thresholded",
        write="INSERT INTO criterion_threshold_range (criterion, value_type, min_value) "
        "SELECT id, value_type, 5 FROM criterion WHERE criteria_set = 'local_employment' "
        "AND attribute = 'country.child_benefit_policy'",
        undo="DELETE FROM criterion_threshold_range WHERE criterion IN (SELECT id FROM criterion "
        "WHERE attribute = 'country.child_benefit_policy')",
        says="cannot roll back 0492: 1 criteria on country.child_benefit_policy carry scale "
        "anchors or a matching threshold (sets: local_employment)",
    ),
    # A figure for the retired house price ratio, which `0444`'s rollback retypes (P95).
    Refusal(
        migration="0444-house-price-ratio-stops-blocking",
        write=a_figure_for("country.house_price_to_income_ratio"),
        undo=a_figure_undone("country.house_price_to_income_ratio"),
        says="cannot roll back 0444: 1 figures are stored",
    ),
    # A saved ranking's frozen rule list is recorded history 0507's rollback would drop (FU-A5).
    # Built in a `DO` block so the evaluation parent exists before its `evaluation_match_rule`
    # child -- a foreign key a sibling wCTE would not reliably see.
    Refusal(
        migration="0507-freeze-the-rest-of-what-a-ranking-was-computed-with",
        write="DO $$ DECLARE ev_id bigint; BEGIN "
        "INSERT INTO evaluation (criteria_set, level, computed_at, score_scale_max, note) "
        "VALUES ('minimal', 'country', now(), 100, 'FU-A5 race row') RETURNING id INTO ev_id; "
        "INSERT INTO evaluation_match_rule (evaluation, match_rule) "
        "VALUES (ev_id, 'li_eea_quota'); END $$",
        undo="DELETE FROM evaluation WHERE note = 'FU-A5 race row'",
        says="cannot roll back 0507: 1 saved-evaluation",
    ),
    # A retry's exact pairs are recorded history 0506's rollback would drop (FU-A5). This run is
    # two candidates and two attributes but only its diagonal two pairs -- a strict subset of its
    # 2x2 rectangle -- so the refusal counts it as one run scoped to pairs. The whole chain goes
    # in a `DO` block so each table's parent exists before its child, and the undo clears the
    # children before the run (the run's references do not cascade).
    Refusal(
        migration="0506-a-run-records-the-exact-pairs-it-asked-about",
        write="DO $$ DECLARE run_id bigint; BEGIN "
        "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
        "VALUES (now(), 'FU-A5 race row', 'completed', 'country') RETURNING id INTO run_id; "
        "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate, level) "
        "VALUES (run_id, 'country.romania', 'country'), (run_id, 'country.portugal', 'country'); "
        "INSERT INTO data_acquisition_run_attribute (data_acquisition_run, attribute, level) "
        "VALUES (run_id, 'country.homicide_rate', 'country'), "
        "(run_id, 'country.housing_cost_overburden_rate', 'country'); "
        "INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute) "
        "VALUES (run_id, 'country.romania', 'country.homicide_rate'), "
        "(run_id, 'country.portugal', 'country.housing_cost_overburden_rate'); END $$",
        undo="DO $$ BEGIN "
        "DELETE FROM data_acquisition_run_item WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'FU-A5 race row'); "
        "DELETE FROM data_acquisition_run_candidate WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'FU-A5 race row'); "
        "DELETE FROM data_acquisition_run_attribute WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'FU-A5 race row'); "
        "DELETE FROM data_acquisition_run WHERE triggered_by = 'FU-A5 race row'; END $$",
        says="cannot roll back 0506: 1 run",
    ),
    # A re-confirmation naming the figure it restated is a link 0511's rollback would drop
    # (PL-049): nothing can re-derive it where two rows could have been restated.
    Refusal(
        migration="0511-a-re-confirmation-names-the-figure-it-restated",
        write="DO $$ DECLARE run_id bigint; figure bigint; BEGIN "
        "INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level) "
        "VALUES (now(), 'PL-049 race row', 'completed', 'country') RETURNING id INTO run_id; "
        # The re-confirmation must be one of its run's items (0513).
        "INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate, level) "
        "VALUES (run_id, 'country.romania', 'country'); "
        "INSERT INTO data_acquisition_run_attribute (data_acquisition_run, attribute, level) "
        "VALUES (run_id, 'country.homicide_rate', 'country'); "
        "INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute) "
        "VALUES (run_id, 'country.romania', 'country.homicide_rate'); "
        "INSERT INTO value (candidate, attribute, value_type, data_source, "
        "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
        "VALUES ('country.romania', 'country.homicide_rate', 'Quantity', 'eurostat', "
        "'2022-01-01', '2022-12-31', now(), 'high') RETURNING id INTO figure; "
        "INSERT INTO value_quantity (value_id, value_type, magnitude, unit) "
        "SELECT figure, 'Quantity', 1, unit FROM attribute_quantity_parameter "
        "WHERE attribute = 'country.homicide_rate'; "
        "INSERT INTO data_acquisition_run_reuse "
        "(data_acquisition_run, data_source, candidate, attribute, value) "
        "VALUES (run_id, 'eurostat', 'country.romania', 'country.homicide_rate', figure); END $$",
        undo="DO $$ BEGIN "
        "DELETE FROM data_acquisition_run_reuse WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'PL-049 race row'); "
        "DELETE FROM value_quantity WHERE value_id IN (SELECT id FROM value "
        "WHERE attribute = 'country.homicide_rate' AND candidate = 'country.romania' "
        "AND data_source = 'eurostat'); "
        "DELETE FROM value WHERE attribute = 'country.homicide_rate' "
        "AND candidate = 'country.romania' AND data_source = 'eurostat'; "
        "DELETE FROM data_acquisition_run_item WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'PL-049 race row'); "
        "DELETE FROM data_acquisition_run_candidate WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'PL-049 race row'); "
        "DELETE FROM data_acquisition_run_attribute WHERE data_acquisition_run IN "
        "(SELECT id FROM data_acquisition_run WHERE triggered_by = 'PL-049 race row'); "
        "DELETE FROM data_acquisition_run WHERE triggered_by = 'PL-049 race row'; END $$",
        says="cannot roll back 0511: 1 re-confirmation",
    ),
    # A deleted criteria set is a row 0508's rollback would quietly bring back as a live one, by
    # dropping the column that says it was deleted (PL-033, T33-B7).
    Refusal(
        migration="0508-criteria-sets-are-deleted-in-place-and-named-uniquely",
        write="UPDATE criteria_set SET deleted_at = now() WHERE id = 'minimal'",
        undo="UPDATE criteria_set SET deleted_at = NULL WHERE id = 'minimal'",
        says="cannot roll back 0508: 1 criteria set(s) are deleted (minimal)",
    ),
    # Recorded history the rollbacks below used to drop or rewrite without refusing (TL-N2,
    # SV-N1): each case writes one row of it.
    Refusal(
        migration="0500-freeze-value-type-lock-and-threshold-in-the-evaluation-snapshot",
        write=a_saved_ranking(A_FROZEN_CRITERION),
        undo=RANKING_UNDONE,
        says="cannot roll back 0500: 1 saved-evaluation criterion row(s)",
    ),
    Refusal(
        migration="0507-freeze-the-rest-of-what-a-ranking-was-computed-with",
        case="columns",
        write=a_saved_ranking(A_FROZEN_CRITERION),
        undo=RANKING_UNDONE,
        says="cannot roll back 0507: 1 saved-evaluation row(s) freeze the pillar locks",
    ),
    Refusal(
        migration="0486-a-saved-ranking-keeps-its-reason-and-its-confidence-split",
        write=a_saved_ranking(A_RESULT),
        undo=RANKING_UNDONE,
        says="cannot roll back 0486: 1 saved result(s)",
    ),
    Refusal(
        migration="0504-a-saved-warning-keeps-the-figures-behind-it",
        write=a_saved_ranking(
            A_RESULT,
            "INSERT INTO candidate_warning (candidate_result, compound_rule, detail) "
            "VALUES (result, 'cheap_but_taxed', 'race');",
            "INSERT INTO value (candidate, attribute, value_type, data_source, "
            "reference_period_start, reference_period_end, retrieval_date, confidence_level) "
            "VALUES ('country.romania', 'country.homicide_rate', 'Quantity', 'oecd', "
            "'2021-01-01', '2021-12-31', now(), 'high') RETURNING id INTO figure;",
            "INSERT INTO value_quantity (value_id, value_type, magnitude, unit) "
            "SELECT figure, 'Quantity', 1, unit FROM attribute_quantity_parameter "
            "WHERE attribute = 'country.homicide_rate';",
            "INSERT INTO candidate_warning_input (candidate_result, compound_rule, value_id) "
            "VALUES (result, 'cheap_but_taxed', figure);",
        ),
        undo=RANKING_UNDONE,
        says="cannot roll back 0504: 1 saved warning input row(s)",
    ),
    Refusal(
        migration="0501-a-run-records-the-figures-it-re-confirmed",
        write=a_run(
            AN_ITEM,
            "INSERT INTO data_acquisition_run_reuse "
            "(data_acquisition_run, data_source, candidate, attribute) "
            "VALUES (run_id, 'oecd', 'country.romania', 'country.homicide_rate');",
        ),
        undo=RUN_UNDONE,
        says="cannot roll back 0501: 1 reuse row(s)",
    ),
    Refusal(
        migration="0461-a-failure-names-its-source",
        write=a_run(
            AN_ITEM,
            "INSERT INTO data_acquisition_failure "
            "(data_acquisition_run, candidate, attribute, error_message, data_source) "
            "VALUES (run_id, 'country.romania', 'country.homicide_rate', 'race', 'oecd');",
        ),
        undo=RUN_UNDONE,
        says="cannot roll back 0461: 1 recorded failure(s)",
    ),
    Refusal(
        migration="0483-a-run-can-be-stopped",
        write=a_run(status="halted_by_user", stop="now()"),
        undo=RUN_UNDONE,
        says="cannot roll back 0483: 1 run(s) were stopped",
    ),
    # A set holding a gate as a warning is a choice 0516's rollback would silently reverse,
    # turning the warning back into a gate that rules candidates out (PL-157, D56).
    Refusal(
        migration="0516-a-set-holds-each-rule-as-a-gate-or-a-warning",
        write="INSERT INTO criteria_set_match_rule "
        "(criteria_set, match_rule, is_enforced, outcome) "
        "VALUES ('minimal', 'uk_skilled_worker', true, 'warning')",
        undo="DELETE FROM criteria_set_match_rule "
        "WHERE criteria_set = 'minimal' AND match_rule = 'uk_skilled_worker'",
        says="cannot roll back 0516: 1 criteria set rule(s)",
    ),
)


@pytest.mark.parametrize(
    "refusal",
    REFUSALS,
    ids=lambda refusal: "-".join(filter(None, (refusal.migration[:4], refusal.case))),
)
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
            outcome = await race(database_url, refusal.migration, writer, before=refusal.before)
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


@pytest.mark.parametrize(("migration", "attribute"), LIFTS, ids=[lift[0][:4] for lift in LIFTS])
async def test_an_edit_written_as_the_application_writes_it_is_carried_through_it(
    migration: str, attribute: str, database_url: str, pool: AsyncConnectionPool
) -> None:
    """**The real writer, not a stand-in.** The application writes a set by locking its row,
    deleting its criteria and inserting them again (`edit_criteria_set`, ST-02), so the rows the
    rollback meets are new ones. That edit, held open until the rollback waits for it, is what the
    rollback's copy reads, and it comes through. Unlocked, the rollback missed the new rows,
    deleted around them, and failed on the foreign key they still held.

    The store's own queries do the writing, in the order `edit_criteria_set` runs them, on a
    connection this test holds open: the store commits as soon as it is done.
    """
    store = PostgresCriteriaStore(pool)
    where = "WHERE criteria_set = %s AND attribute = %s"
    # The row shape the store's own `acquire` gives every connection it uses.
    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=namedtuple_row
    ) as writer:
        stored = await (
            await writer.execute(
                f"SELECT weight_locked FROM criterion {where}", (EDITED_SET, attribute)
            )
        ).fetchone()
        assert stored is not None, f"{EDITED_SET} has no criterion on {attribute} to edit"
        await writer.commit()
        try:
            await store._queries.lock_criteria_set(writer, criteria_set=EDITED_SET)
            current = _criteria_set_from(
                await store._queries.select_criteria_set(
                    writer, criteria_set=EDITED_SET, level=None, include_deleted=False
                )
            )
            edited = current.model_copy(
                update={
                    "criteria": tuple(
                        criterion.model_copy(update={"weight_locked": not stored[0]})
                        if str(criterion.attribute) == attribute
                        else criterion
                        for criterion in current.criteria
                    )
                }
            )
            await store._queries.delete_criteria_set_contents(writer, criteria_set=EDITED_SET)
            await store._write_contents(writer, edited)
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
        f"{migration} should have carried the edit the application committed while it waited, "
        f"and came to {outcome!r}"
    )


def test_0507_locks_the_tables_a_save_writes_in_the_order_the_save_writes_them() -> None:
    """**Two writers that take the same locks in opposite orders can deadlock.** A save writes
    a ranking's frozen criteria, then its rule lists, then its warning and non-match inputs;
    `0507`'s rollback locks those tables before it counts them, and in the same order, so
    whichever starts first finishes first."""
    root = MIGRATIONS.parent
    store = (root.parent / "backend/src/starnest/storage/evaluation_store.py").read_text()
    queries = (root / "queries" / "evaluation.sql").read_text()
    written_by = dict(
        re.findall(r"-- name: (\w+)\(?[^\n]*\n(?:--[^\n]*\n)*\s*INSERT INTO (\w+)", queries)
    )
    save_order = [
        written_by[query]
        for query in re.findall(r"self\._queries\.(insert_\w+)\(", store)
        if query in written_by
    ]
    lock = re.search(
        r"LOCK TABLE ([^;]*?) IN SHARE ROW EXCLUSIVE MODE",
        (
            MIGRATIONS / "0507-freeze-the-rest-of-what-a-ranking-was-computed-with.rollback.sql"
        ).read_text(),
    )
    assert lock is not None
    locked = [name.strip() for name in lock.group(1).split(",")]

    assert locked == [table for table in save_order if table in locked]
