"""`tools/migrate.py` hands yoyo the URL the backend reads from `.env` (RF-1)."""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

from starnest.main import Environment

SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "migrate.py"
URL = "postgresql://appuser:pw@127.0.0.1:5432/appdb"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migrate_script", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migrate = load_script()

WRITTEN = {
    "quoted, then a comment (RF-1)": f'DATABASE_URL="{URL}" # migration connection',
    "trailing spaces": f"DATABASE_URL={URL}   ",
    "single-quoted": f"DATABASE_URL='{URL}'",
    "inner spaces and a hash, quoted": f'DATABASE_URL="{URL.replace("pw", "two  w#rds")}"',
    "bare": f"DATABASE_URL={URL}",
}


@pytest.mark.parametrize("line", WRITTEN.values(), ids=WRITTEN.keys())
@pytest.mark.parametrize("command", ["apply", "rollback"])
def test_yoyo_is_handed_exactly_the_url_the_backend_reads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, line: str, command: str
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    env = tmp_path / ".env"
    env.write_text(line + "\n")
    backend_reads = Environment(_env_file=env).database_url  # type: ignore[call-arg]

    arguments = migrate.yoyo_arguments(command, env)

    assert arguments == [
        command,
        "--batch",
        "--database",
        backend_reads.replace("postgresql://", "postgresql+psycopg://", 1),
        str(SCRIPT.parents[1] / "storage" / "migrations"),
    ]
    assert '"' not in arguments[3] and not arguments[3].endswith(" ")


def test_a_url_in_the_shell_does_not_redirect_a_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`.env` wins, as it did when make read it: a stale export cannot pick the database."""
    monkeypatch.setenv("DATABASE_URL", URL.replace("appdb", "elsewhere"))
    env = tmp_path / ".env"
    env.write_text(f"DATABASE_URL={URL}\n")

    assert migrate.yoyo_arguments("apply", env)[3].endswith("/appdb")


@pytest.mark.parametrize(
    ("command", "content", "says"),
    [
        ("apply", "POSTGRES_DB=appdb\n", "no DATABASE_URL"),
        ("upgrade", f"DATABASE_URL={URL}\n", "usage"),
    ],
    ids=["no url", "unknown command"],
)
def test_it_refuses_without_naming_the_password(
    tmp_path: Path, command: str, content: str, says: str
) -> None:
    env = tmp_path / ".env"
    env.write_text(content)

    with pytest.raises(SystemExit, match=says) as refused:
        migrate.yoyo_arguments(command, env)

    assert "pw@" not in str(refused.value)
