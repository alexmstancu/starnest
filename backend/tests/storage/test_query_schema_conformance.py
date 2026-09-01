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
