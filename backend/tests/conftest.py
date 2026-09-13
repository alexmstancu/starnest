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

import functools
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest
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


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip everything that spends money unless the run asked for it by name.

    **A default exclusion that any explicit `-m` silently overrides is not an exclusion.**
    `pyproject.toml` sets `-m 'not live_llm'` in `addopts`, and pytest lets the last `-m` win --
    so `make test` (`-m "not storage and not acceptance and not live"`) and `make coverage`
    (`-m "not live"`) both put the paid tests back in, and `make check` runs `coverage`. That
    was true from the day the marker was added and nobody noticed, because the tests skipped for
    want of an API key until they were fixed to read the configuration properly
    (`known-issues.md` P34, P35).

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
