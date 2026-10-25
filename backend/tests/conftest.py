"""Shared fixtures.

The database fixtures here implement devplan.md 0.5: every test run uses a database named
for its workstream, so two agents running `pytest` at the same moment never see each other's
rows. Set WORKSTREAM in the environment (`WORKSTREAM=w2b uv run pytest -m storage`); it
defaults to `local` for a developer running the suite by hand.

Storage tests run against a REAL PostgreSQL, never a fake. The schema carries the
type-agreement constraints, the one-of checks and the singleton checks (arch.md 3.3b), and
testing those against a fake proves nothing -- the constraints ARE the behaviour under test
(arch.md 6.7).
"""

import asyncio
import functools
import os
import subprocess
from collections.abc import Awaitable, Callable, Collection, Iterator
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest
from psycopg import AsyncConnection
from pydantic import ValidationError

from starnest.main import Environment

BACKEND_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = BACKEND_ROOT.parent / "storage" / "migrations"
ENV_FILE = BACKEND_ROOT.parent / ".env"


def _workstream() -> str:
    return os.environ.get("WORKSTREAM", "local")


@functools.cache
def _configured_url() -> str:
    """The connection string, loaded the way the application itself loads it.

    Reusing `Environment` rather than parsing `.env` again keeps one definition of how
    configuration is read (arch.md 6.8). `.env` lives at the repository root while pytest
    runs from `backend/`, so the path is given explicitly.
    """
    try:
        return Environment(_env_file=ENV_FILE).database_url
    except ValidationError:
        pytest.skip("DATABASE_URL is not configured — run `make env`, then `make up`")


def _with_database(database: str) -> str:
    return urlunparse(urlparse(_configured_url())._replace(path=f"/{database}"))


def _admin_url() -> str:
    """Creating and dropping a database cannot be done while connected to it, so setup
    runs against the maintenance database."""
    return _with_database("postgres")


def _yoyo_url(url: str) -> str:
    """yoyo names its driver in the scheme; psycopg3 does not.

    A plain `postgresql://` resolves to yoyo's psycopg2 backend, which is not installed and
    never will be. `postgresql+psycopg://` is the psycopg3 one. The application keeps the
    standard libpq form because that is what psycopg3 itself expects, so the translation
    lives here rather than in a second environment variable that could drift.
    """
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A freshly migrated database, private to this workstream.

    Dropped and recreated per session rather than cleaned between tests: a migration bug
    that only appears on a fresh database is exactly the bug worth catching, and it would
    hide behind a long-lived test database.
    """
    name = f"starnest_test_{_workstream()}"

    with psycopg.connect(_admin_url(), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{name}"')

    url = _with_database(name)
    applied = subprocess.run(
        ["uv", "run", "yoyo", "apply", "--batch", "--database", _yoyo_url(url), str(MIGRATIONS)],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    if applied.returncode != 0:
        pytest.fail(f"migrations failed to apply:\n{applied.stdout}\n{applied.stderr}")

    yield url

    with psycopg.connect(_admin_url(), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def connection(database_url: str) -> Iterator[psycopg.Connection]:
    """A connection whose work is rolled back afterwards, so tests stay independent."""
    with psycopg.connect(database_url) as conn:
        yield conn
        conn.rollback()


LOCK_PATIENCE_SECONDS = 120
"""How long a barrier waits for the database to report a wait: generous, because the machine
running the suite may be loaded many times over, and a barrier that passes never waits this long."""


@pytest.fixture
def wait_until_blocked(database_url: str) -> Callable[..., Awaitable[int]]:
    """`await wait_until_blocked(task, on={pid, ...})`: the backend pid of a session, not in `on`,
    waiting on a lock one of `on` holds -- once the database says so.

    **A barrier on the server's own account of who waits on whom**, never on time: a race test is
    decided by lock order, so its next step is taken only once the previous one is seen waiting.
    Each poll opens a connection of its own, in autocommit, because inside one transaction
    `pg_stat_activity` is a snapshot taken at its first read: a session that connected later was
    invisible to it, which is how a loaded machine made these tests flake. The test fails, rather
    than going on, if `task` ends without ever waiting.

    `on` takes more than one pid because a row lock queues behind a waiter as well as a holder:
    the second session to want a row held by a third waits on the first waiter's tuple lock, and
    `pg_blocking_pids` names that waiter rather than the holder.
    """

    async def until_blocked(task: asyncio.Task, *, on: Collection[int]) -> int:
        blockers = sorted(on)
        deadline = asyncio.get_running_loop().time() + LOCK_PATIENCE_SECONDS
        while asyncio.get_running_loop().time() < deadline:
            async with await AsyncConnection.connect(database_url, autocommit=True) as probing:
                waiting = await (
                    await probing.execute(
                        "SELECT pid FROM pg_stat_activity"
                        " WHERE pg_blocking_pids(pid) && %(blockers)s::int[]"
                        " AND NOT pid = ANY (%(blockers)s::int[])"
                        " ORDER BY pid LIMIT 1",
                        {"blockers": blockers},
                    )
                ).fetchone()
            if waiting is not None:
                return waiting[0]
            if task.done():
                pytest.fail(f"it ended without waiting on any of {blockers}: {task!r}")
            await asyncio.sleep(0.05)
        pytest.fail(f"nothing waited on any of {blockers} within {LOCK_PATIENCE_SECONDS}s")

    return until_blocked


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip everything that spends money unless the run asked for it by name.

    **A default exclusion that any explicit `-m` silently overrides is not an exclusion.**
    `pyproject.toml` sets `-m 'not live and not live_llm'` in `addopts`, and pytest lets the last
    `-m` win -- so `make test` (`-m "not storage and not acceptance and not live"`) and
    `make coverage` (`-m "not live"`) both put the paid tests back in, and `make check` runs
    `coverage`. That was true from the day the marker was added and nobody noticed, because the
    tests skipped for want of an API key until they were fixed to read the configuration
    properly (`known-issues.md` P34, P35).

    This is the same fault as P8, where the gate called Eurostat: a marker nobody selected still
    ran. The difference is what it costs. `make check` must never spend money (`arch.md` 6.7),
    so the guard is here rather than in the marker expression -- one place, and no way to forget
    it while writing a new `-m`.
    """
    asked_for_it = "live_llm" in (config.getoption("-m") or "")
    if asked_for_it:
        return
    refusal = pytest.mark.skip(reason="spends money; run `make live-llm`, which selects it by name")
    for item in items:
        if "live_llm" in item.keywords:
            item.add_marker(refusal)
