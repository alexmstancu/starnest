"""`tools/e2e_copy.py` reaches only a copy, and names no password when it refuses (P100).

How the URL carries every spelling of a password is proved by running make, in
`test_make_isolation.py`; these are the script's own refusals and hand-overs.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "e2e_copy.py"
SECRET = "pw-SECRET-123"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("e2e_copy_script", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e2e_copy = load_script()


@pytest.fixture
def env_file(tmp_path: Path) -> Path:
    env = tmp_path / ".env"
    env.write_text(f"POSTGRES_USER=appuser\nPOSTGRES_PASSWORD={SECRET}\nDATABASE_PORT=5432\n")
    return env


@pytest.mark.parametrize(
    "name",
    ["appdb", "appdb_e2e2", "app db_e2e", "app$db_e2e", "é_e2e", "d" * 60 + "_e2e", ""],
    ids=[
        "the live name",
        "not ending in _e2e",
        "a space",
        "a dollar",
        "an accent",
        "64 bytes",
        "empty",
    ],
)
def test_only_a_copys_name_is_reached(env_file: Path, name: str) -> None:
    with pytest.raises(SystemExit, match="not a copy's name") as refused:
        e2e_copy.copy_url(name, env_file, {})

    assert SECRET not in str(refused.value)


def test_a_name_of_63_bytes_is_a_copy(env_file: Path) -> None:
    assert e2e_copy.copy_url("d" * 59 + "_e2e", env_file, {}).endswith("/" + "d" * 59 + "_e2e")


@pytest.mark.parametrize(
    ("line", "says"),
    [
        ("DATABASE_PORT=54x2", "DATABASE_PORT"),
        ("DATABASE_PORT=65536", "DATABASE_PORT"),
        ("DATABASE_PORT=0", "DATABASE_PORT"),
        ("DATABASE_PORT=٥٤٣٢", "DATABASE_PORT"),
        ("POSTGRES_USER=", "no POSTGRES_USER"),
    ],
    ids=["not a number", "too high", "zero", "non-ASCII digits", "no user"],
)
def test_a_setting_that_cannot_reach_the_copy_is_refused_without_the_password(
    env_file: Path, line: str, says: str
) -> None:
    env_file.write_text(env_file.read_text() + line + "\n")

    with pytest.raises(SystemExit, match=says) as refused:
        e2e_copy.copy_url("appdb_e2e", env_file, {})

    assert SECRET not in str(refused.value)


def test_an_empty_port_is_postgresqls_own(env_file: Path) -> None:
    """As compose's `${DATABASE_PORT:-5432}` reads it."""
    env_file.write_text(env_file.read_text() + "DATABASE_PORT=\n")

    assert "@127.0.0.1:5432/" in e2e_copy.copy_url("appdb_e2e", env_file, {"DATABASE_PORT": "1"})


def test_the_suite_is_handed_the_copys_url_over_any_it_inherited(env_file: Path) -> None:
    inherited = {"E2E_DATABASE_URL": "postgresql://appuser@127.0.0.1/appdb", "PATH": "/bin"}

    environment = e2e_copy.suite_environment("appdb_e2e", env_file, inherited)

    assert environment["E2E_DATABASE_URL"].endswith("/appdb_e2e")
    assert environment["PATH"] == "/bin"


def test_the_suite_replaces_the_script_with_npm_in_the_interface(
    env_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(e2e_copy, "ROOT", env_file.parent)
    (env_file.parent / "ui").mkdir()
    monkeypatch.chdir(env_file.parent)
    handed: list[tuple[str, list[str], dict[str, str]]] = []

    def replace_the_process(
        program: str, arguments: list[str], environment: dict[str, str]
    ) -> None:
        handed.append((program, arguments, environment))
        raise SystemExit(0)  # execvpe never returns

    monkeypatch.setattr(e2e_copy.os, "execvpe", replace_the_process)

    with pytest.raises(SystemExit):
        e2e_copy.main(["suite", "appdb_e2e", "e2e/sanity.spec.ts"])

    [(program, arguments, environment)] = handed
    assert (program, arguments) == ("npm", ["npm", "run", "e2e", "--", "e2e/sanity.spec.ts"])
    assert environment["E2E_DATABASE_URL"].endswith("/appdb_e2e")
    assert Path.cwd() == env_file.parent / "ui"


def test_the_migration_is_handed_to_yoyo_in_process(
    env_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[list[str]] = []
    monkeypatch.setattr(e2e_copy, "yoyo", lambda arguments: called.append(arguments) or 0)

    assert e2e_copy.migrate("appdb_e2e", env_file) == 0

    [arguments] = called
    assert arguments[:3] == ["apply", "--batch", "--database"]
    assert arguments[3] == f"postgresql+psycopg://appuser:{SECRET}@127.0.0.1:5432/appdb_e2e"
    assert arguments[4] == str(SCRIPT.parents[1] / "storage" / "migrations")


@pytest.mark.parametrize(
    "arguments",
    [[], ["suite"], ["upgrade", "appdb_e2e"], ["migrate", "appdb_e2e", "extra"]],
    ids=["nothing", "no name", "unknown command", "arguments to a migration"],
)
def test_it_refuses_a_command_it_does_not_know(arguments: list[str]) -> None:
    with pytest.raises(SystemExit, match="usage"):
        e2e_copy.main(arguments)
