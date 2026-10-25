"""Private databases at a revision of their own, for tests that run migrations for real.

The session's database is at the head, where a migration under test has long since been followed
by others; what a migration or a rollback does is a question about the schema it was written
for. So these tests build a database of their own, move it with yoyo itself, and drop it after.
Each name has its own namespace and a bounded length, so it is never another workstream's
database (RE-8).
"""

import hashlib
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
from yoyo import get_backend, read_migrations

BACKEND_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = BACKEND_ROOT.parent / "storage" / "migrations"


def on(url: str, database: str) -> str:
    return urlunparse(urlparse(url)._replace(path=f"/{database}"))


def run_yoyo(*arguments: str, database: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "uv",
            "run",
            "yoyo",
            *arguments,
            "--batch",
            "--database",
            database.replace("postgresql://", "postgresql+psycopg://", 1),
            str(MIGRATIONS),
        ],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def yoyo(*arguments: str, database: str) -> None:
    done = run_yoyo(*arguments, database=database)
    assert done.returncode == 0, done.stdout + done.stderr


def apply_through(revision: str, *, database: str) -> None:
    """Every migration numbered up to and including `revision`, as the head reached it.

    Not `yoyo apply --revision`, which applies only what `revision` depends on: a `depends:`
    line names one predecessor, often far back, so that would leave out tables the migrations
    numbered between them had built by the time this one ran.
    """
    backend = get_backend(database.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        wanted = read_migrations(str(MIGRATIONS)).filter(lambda migration: migration.id <= revision)
        with backend.lock():
            backend.apply_migrations(backend.to_apply(wanted))
    finally:
        backend.connection.close()


def private_name(database_url: str, purpose: str) -> str:
    return f"starnest_{purpose}_" + hashlib.sha256(database_url.encode()).hexdigest()[:16]


@contextmanager
def private_database(
    database_url: str,
    purpose: str,
    *,
    revision: str | None = None,
    template: str | None = None,
    empty: bool = False,
) -> Iterator[str]:
    """A database of its own, copied from `template` if one is named, then migrated through
    `revision`, or to the head when `revision` is None and there is no template -- or left
    `empty`, for a test that brings migrations of its own."""
    name = private_name(database_url, purpose)
    copied_from = f' TEMPLATE "{urlparse(template).path.lstrip("/")}"' if template else ""
    with psycopg.connect(on(database_url, "postgres"), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{name}"{copied_from}')
    try:
        url = on(database_url, name)
        if empty:
            pass
        elif revision is not None:
            apply_through(revision, database=url)
        elif template is None:
            yoyo("apply", database=url)
        yield url
    finally:
        with psycopg.connect(on(database_url, "postgres"), autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
