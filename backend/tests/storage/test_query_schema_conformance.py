"""Every query in `storage/queries/` is checked against the real schema.

**SQL is the one part of this codebase with no compiler.** Python fails at import and
TypeScript fails at build, but a `.sql` file naming a column that no longer exists fails only
when something first executes it -- which may be months later, in a code path nobody runs
often. That risk went up when the queries moved to a top-level `storage/` directory (reqs.md
Q200), because the point of moving them was that people would edit them directly.

`PREPARE` closes it. It fully validates a statement -- tables, columns, types, syntax --
without executing it and without needing a single fixture row. So a migration that renames a
column fails in the migration's own commit, naming the query, rather than at runtime.

This file is the cheap total layer. `test_active_value_behaviour.py` is the expensive
selective one: this proves every query *can* run, that one proves the subtle ones are *right*.
"""

import re
from pathlib import Path

import aiosql
import psycopg
import pytest

pytestmark = pytest.mark.storage

QUERIES = Path(__file__).resolve().parents[3] / "storage" / "queries"


def _to_dollar_placeholders(sql: str) -> str:
    """psycopg speaks `%s` and `%(name)s`; PREPARE speaks `$1`. Same query, two dialects.

    A repeated `%(name)s` maps to the same `$n`, which is what PREPARE expects and what
    psycopg does with the named form anyway.
    """
    numbered: dict[str, int] = {}

    def name_to_dollar(match: re.Match[str]) -> str:
        numbered.setdefault(match.group(1), len(numbered) + 1)
        return f"${numbered[match.group(1)]}"

    sql = re.sub(r"%\((\w+)\)s", name_to_dollar, sql)

    parts = sql.split("%s")
    if len(parts) == 1:
        return sql
    position = len(numbered)
    rebuilt = parts[0]
    for part in parts[1:]:
        position += 1
        rebuilt += f"${position}{part}"
    return rebuilt


def _all_queries() -> list[tuple[str, str]]:
    """Every named query, loaded the way production loads them.

    Going through `aiosql` rather than reading the files means a malformed `-- name:` header
    fails here, at collection time, instead of at application startup.
    """
    loaded = aiosql.from_path(QUERIES, "psycopg")
    named = []
    for name in sorted(n for n in dir(loaded) if not n.startswith("_")):
        sql = getattr(getattr(loaded, name), "sql", None)
        if sql:
            named.append((name, sql))
    return named


ALL_QUERIES = _all_queries()


def test_the_query_directory_is_not_empty() -> None:
    """A sweep that silently found nothing would pass forever.

    If the directory moves again, or `aiosql` stops recognising the headers, every
    parametrised test below would simply vanish rather than fail. This is the guard on the
    guard.
    """
    assert len(ALL_QUERIES) > 50, f"only {len(ALL_QUERIES)} queries found under {QUERIES}"


@pytest.mark.parametrize("name,sql", ALL_QUERIES, ids=[n for n, _ in ALL_QUERIES])
def test_query_matches_the_schema(connection: psycopg.Connection, name: str, sql: str) -> None:
    """Every table, column and type the query names exists and agrees.

    Failure here means one of two things, and the message says which: the schema changed and
    this query was not updated, or the query was wrong when it was written.
    """
    try:
        connection.execute(f"PREPARE conformance_probe AS {_to_dollar_placeholders(sql)}")
    except psycopg.Error as mismatch:
        pytest.fail(f"{name} does not match the schema: {mismatch}")
    finally:
        connection.rollback()


SOURCE = Path(__file__).resolve().parents[2] / "src" / "starnest"

QUERIES_NOTHING_CALLS_YET = {
    # **Superseded by writing a set whole.** `PostgresCriteriaStore` reads a set, asks the
    # domain for the new one and writes the result back, so the per-weight statements below --
    # and the reads that would feed them -- describe a mechanism nothing uses. The atomicity
    # argument written into them is sound and is simply argued about something else now.
    "update_criterion_weight": "the store writes a set whole; a slider drag goes through that",
    "update_criterion_weights": "same: rebalancing arrives as a whole set, not a pillar",
    "update_pillar_weights": "same: pillar weights are written with the set that holds them",
    "select_criteria_in_pillar": "rebalancing reads the whole set, so the siblings come with it",
    "select_criterion": "the PATCH path reads the set, not one criterion",
    "clear_criterion_thresholds": "`delete_criteria_set_contents` clears them with everything else",
    # **Waiting for an operation the contract does not have.** `openapi.yaml` is deliberately
    # ahead of the code, and these are behind even that: no operation deletes a criterion, an
    # evaluation or renames a candidate. Each is one endpoint away from being live.
    "delete_criterion": "no operation detaches a criterion; `openapi.yaml` does not name one",
    "delete_evaluation": "no operation discards a kept evaluation",
    "update_candidate_name": "no operation corrects a display name",
    # **Waiting for a feature that is planned and not built.** The run planner does not yet
    # consider what is already fresh, and the acquisition screen does not yet report catalog
    # coverage -- both are named in `reqs.md` and neither is written.
    "clear_run_failure": "a failure that later succeeded in the same run is not yet unmarked",
    "select_run_values": "nothing asks which items a run answered without their payloads",
    "select_last_retrieval_dates": "the planner does not yet skip what is still fresh",
    "select_attribute_coverage": "no screen reports coverage of the catalog per attribute",
    "select_attribute_source_priority": "the overrides travel on the attribute, read with it",
    # **Reference data nothing serves.** The four vocabularies are read from the catalog by
    # migration and enforced by foreign keys; no endpoint lists them, and the payload dispatcher
    # asserts against its own enum rather than against the database.
    "select_value_types": "no endpoint lists the ten archetypes",
    "select_units": "no endpoint lists the units a Quantity may carry",
    "select_currencies": "no endpoint lists the currencies a Monetary may carry",
    "select_confidence_levels": "no endpoint lists the four grades",
    "select_household_fields": "no endpoint lists the household numbers a rule may read",
}
"""Queries that exist and nothing calls, each with the reason it is still here (P62).

**A query nothing runs is not a failure, and being unable to tell is.** Every statement here is
`PREPARE`d by the test above, so dead SQL stays permanently green: that proves it *can* run,
never that anything runs it. Nineteen blocks had drifted out of use with nothing recording
which were ahead of the code and which were simply forgotten -- including the whole weight-edit
path, whose comment still says "a slider drag writes this".

**This list is meant to shrink.** Adding a query without a caller now fails until somebody says
why it is here, and deleting one that turns out to be forgotten is a two-line change: git
remembers the SQL, and `Later Equals Never` says the list should not grow quietly.
"""


def _called_from_source(name: str) -> bool:
    """Whether any Python under `src/` names this query.

    A text search rather than an import graph, because aiosql attaches queries by name at
    runtime: `self._queries.select_criteria_set(...)` is the only evidence there is, and it is
    the same evidence a reader has.
    """
    return any(name in path.read_text() for path in SOURCE.rglob("*.py"))


def test_every_query_is_either_called_or_accounted_for() -> None:
    """The guard the `PREPARE` sweep above cannot be: is anything actually running this?

    Two ways to fail, and the message says which. A query nothing calls and nothing explains is
    a loose end; an entry in the exemption list that something now calls is an entry to delete.
    """
    # `aiosql` generates a `<name>_cursor` alias for every `select`, so those are the same
    # statement under a second name rather than a query of their own.
    uncalled = {
        name
        for name, _ in ALL_QUERIES
        if not name.endswith("_cursor") and not _called_from_source(name)
    }

    unexplained = sorted(uncalled - set(QUERIES_NOTHING_CALLS_YET))
    assert not unexplained, (
        f"{len(unexplained)} quer(y|ies) nothing calls and nothing explains: "
        f"{unexplained}. Either wire it up, delete it, or add it to "
        "QUERIES_NOTHING_CALLS_YET with the reason it is still here."
    )

    now_called = sorted(set(QUERIES_NOTHING_CALLS_YET) - uncalled)
    assert not now_called, (
        f"{now_called} are called now and still listed as uncalled. Remove them from "
        "QUERIES_NOTHING_CALLS_YET -- the list is the record of what is waiting, not a "
        "list of everything that was ever waiting."
    )
