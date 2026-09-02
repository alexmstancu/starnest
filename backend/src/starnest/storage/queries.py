"""Where the SQL lives, and the one place it is loaded from.

`arch.md` 10.2. Every statement this module runs is a named block in a `.sql` file under the
repository's top-level `storage/queries/`, loaded through `aiosql` and never written as a
Python string. That is what makes "storage is the only module that writes SQL" literal rather
than a habit: a query can be pasted into `psql` exactly as it appears, and
`test_query_schema_conformance.py` PREPAREs every one of them against the real schema.

**The SQL sits outside the Python package deliberately** (`reqs.md` Q200). It is a system
asset that a person edits directly, not an implementation detail of a package -- so the path
is resolved from this file rather than from a package resource. The container mirrors the
repository for exactly this reason (`backend/Dockerfile`): `storage/` sits beside `backend/`
in both, so one expression finds the directory in development and in the image alike.
"""

import functools
from pathlib import Path

import aiosql
from aiosql.queries import Queries

DRIVER = "apsycopg"
"""`aiosql`'s async psycopg3 adapter, registered under a name nobody would guess.

`psycopg` is the *synchronous* adapter and would return coroutine-free rows from an async
connection, so the name is not a detail to be tidied (`arch.md` 10.2).
"""

_REPOSITORY_ROOT_DEPTH = 4
"""How far above this file the repository root sits: `backend/src/starnest/storage/`.

Stated as a name rather than as a bare `4` because it is the one thing that would silently
break if this file moved, and a number in a subscript would not say so.
"""

QUERY_DIRECTORY = Path(__file__).resolve().parents[_REPOSITORY_ROOT_DEPTH] / "storage" / "queries"


@functools.cache
def load_queries() -> Queries:
    """Every named query, parsed once per process.

    Cached because parsing the directory is pure and its result is immutable: the stores each
    ask for the queries at construction, and a second parse would only produce a second copy
    of the same object graph.
    """
    return aiosql.from_path(QUERY_DIRECTORY, DRIVER)
