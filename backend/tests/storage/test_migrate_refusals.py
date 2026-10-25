"""`make migrate` and `make rollback` show a refusal, never a traceback (P95).

Run through `tools/migrate.py` itself, on a private database and a migrations directory of
this test's own: one rollback meets a foreign key the database enforces, the other refuses in
its own words.
"""

import importlib.util
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import psycopg
import pytest

from .private_database import private_database

pytestmark = [pytest.mark.storage, pytest.mark.filterwarnings("ignore:Only rolling back")]

SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "migrate.py"

MIGRATIONS = {
    "0001-parent-and-child": (
        "CREATE TABLE parent (id text PRIMARY KEY);\n"
        "CREATE TABLE child (parent text NOT NULL REFERENCES parent (id));\n",
        "DROP TABLE child;\nDROP TABLE parent;\n",
    ),
    "0002-a-parent": (
        "-- depends: 0001-parent-and-child\nINSERT INTO parent (id) VALUES ('kept');\n",
        "DELETE FROM parent WHERE id = 'kept';\n",
    ),
}

REFUSING = (
    "-- depends: 0002-a-parent\nSELECT 1;\n",
    "DO $$ BEGIN RAISE EXCEPTION 'cannot roll back 0003: restore the backup'; END $$;\n",
)


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migrate_script", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migrate = load_script()


@pytest.fixture
def empty_database(database_url: str) -> Iterator[str]:
    with private_database(database_url, "migrate_refusal", empty=True) as url:
        yield url


def write(directory: Path, migrations: dict[str, tuple[str, str]], env: str) -> Path:
    for name, (forward, backward) in migrations.items():
        (directory / f"{name}.sql").write_text(forward)
        (directory / f"{name}.rollback.sql").write_text(backward)
    (directory / ".env").write_text(f"DATABASE_URL={env}\n")
    return directory / ".env"


def applied(url: str) -> list[str]:
    with psycopg.connect(url) as connection:
        rows = connection.execute("SELECT migration_id FROM _yoyo_migration ORDER BY 1")
        return [row[0] for row in rows]


def test_a_foreign_key_a_rollback_meets_is_named_with_its_remedy(
    empty_database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    env = write(tmp_path, MIGRATIONS, empty_database)
    said: list[str] = []
    assert migrate.run("apply", env, tmp_path, said.append) == 0
    with psycopg.connect(empty_database) as connection:
        connection.execute("INSERT INTO child (parent) VALUES ('kept')")

    assert migrate.run("rollback", env, tmp_path, said.append) == 1

    shown = "\n".join(said) + capsys.readouterr().err
    assert "table: child, constraint: child_parent_fkey" in shown
    assert "is still referenced from table" in shown
    assert migrate.NOTHING_CHANGED in shown
    assert migrate.REMEDY in shown
    assert "Traceback" not in shown
    assert applied(empty_database) == list(MIGRATIONS)


def test_a_migrations_own_refusal_is_shown_as_written(
    empty_database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    env = write(tmp_path, {**MIGRATIONS, "0003-refuses": REFUSING}, empty_database)
    said: list[str] = []
    assert migrate.run("apply", env, tmp_path, said.append) == 0

    assert migrate.run("rollback", env, tmp_path, said.append) == 1

    shown = "\n".join(said) + capsys.readouterr().err
    assert "migrate: cannot roll back 0003: restore the backup" in said
    assert "Traceback" not in shown
    assert "0003-refuses" in applied(empty_database)
