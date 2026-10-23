"""The browser suite's make targets reach only their own copy, and compose never hears the
command line (UIC-A1, INF-G2, INF-M1, INF-M2).

**Run, not read.** The guards these replace matched the recipes' text, and the text was right
while the behaviour was not:
- an ordinary assignment loses to a command-line one;
- GNU make exports every command-line variable to every recipe, and `docker compose` reads it
  before `.env`;
- a recipe line that names `$(MAKE)` runs even under `make -n`.

So these tests run the real `make` on a copy of the Makefile, in a sandbox whose `docker`, `uv`
and `npm` are fakes. The fakes record how they were called and fail when asked to. Nothing here
starts a container or touches a database.
"""

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]

SECRET = "pw-SECRET-123"
LIVE = "appdb"
COPY = f"{LIVE}_e2e"
LIVE_URL = f"postgresql://appuser:{SECRET}@127.0.0.1:5432/{LIVE}"
COPY_URL = f"postgresql://appuser:{SECRET}@127.0.0.1:5432/{COPY}"
DROP_ONLY = f"dropdb --if-exists --force {COPY}"

DATABASE_TOOLS = ("dropdb", "createdb", "pg_restore")

# One line per call: the tool, its arguments (unit separator) and the database the browser
# suite would be pointed at (record separator).
FAKE_TOOL = r"""#!/bin/sh
{
  printf '%s' "${0##*/}"
  for argument in "$@"; do printf '\037%s' "$argument"; done
  printf '\036%s\n' "${E2E_DATABASE_URL-}"
} >> "$FAKE_LOG"
case "${0##*/}" in
  docker)
    for argument in "$@"; do last=$argument; done
    [ "$last" = "${FAKE_DOCKER_FAIL_SCRIPT-}" ] && exit 1
    case "$last" in *"${FAKE_DOCKER_FAIL_CONTAINS:-@never@}"*) exit 1 ;; esac
    [ -n "${FAKE_DOCKER_RUNS_SCRIPT-}" ] && exec sh -c "$last" ;;
  npm) exit "${FAKE_NPM_EXIT:-0}" ;;
esac
exit 0
"""


@dataclass(frozen=True)
class Call:
    tool: str
    arguments: tuple[str, ...]
    suite_database: str

    @property
    def script(self) -> str:
        """What the tools container was asked to run: `sh -c`'s argument, always the last."""
        return self.arguments[-1]


class Sandbox:
    """A copy of the Makefile with a `.env`, one backup, and fake tools first on PATH."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.log = root / "calls.log"
        shutil.copy(ROOT / "Makefile", root / "Makefile")
        (root / ".env").write_text(
            f"POSTGRES_DB={LIVE}\nPOSTGRES_USER=appuser\nPOSTGRES_PASSWORD={SECRET}\n"
            f"DATABASE_PORT=5432\nDATABASE_URL={LIVE_URL}\n"
        )
        for directory in ("backend", "ui", "storage/migrations", "backups", "bin"):
            (root / directory).mkdir(parents=True)
        (root / "backups" / "20990101-000000.dump").touch()
        # The database tools are faked too, for the tests that let `docker` run the tools
        # container's script: what they record is what the database would have been handed.
        for tool in ("docker", "uv", "npm", *DATABASE_TOOLS):
            fake = root / "bin" / tool
            fake.write_text(FAKE_TOOL)
            fake.chmod(0o755)

    def make(self, *arguments: str, **environment: str) -> subprocess.CompletedProcess[str]:
        # A fresh environment: no MAKEFLAGS or MAKELEVEL from a `make check` above us.
        return subprocess.run(
            ["make", "--no-print-directory", *arguments],
            cwd=self.root,
            env={
                "PATH": f"{self.root / 'bin'}:/usr/bin:/bin",
                "HOME": str(self.root),
                "FAKE_LOG": str(self.log),
                **environment,
            },
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )

    def calls(self) -> list[Call]:
        if not self.log.exists():
            return []
        calls = []
        # `split`, not `splitlines`: the latter also breaks on the record separator.
        for line in filter(None, self.log.read_text().split("\n")):
            invocation, suite_database = line.split("\x1e")
            tool, *arguments = invocation.split("\x1f")
            calls.append(Call(tool, tuple(arguments), suite_database))
        return calls

    def calls_to(self, tool: str) -> list[Call]:
        return [call for call in self.calls() if call.tool == tool]


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    return Sandbox(tmp_path)


def output(result: subprocess.CompletedProcess[str]) -> str:
    return result.stdout + result.stderr


def targets() -> list[str]:
    """Every target the Makefile declares. A target-specific variable repeats a target's name,
    which the set absorbs."""
    text = (ROOT / "Makefile").read_text()
    return sorted(set(re.findall(r"^([A-Za-z0-9_-]+):(?!=)", text, re.MULTILINE)))


def compose_variables() -> list[str]:
    """Every variable `compose.yaml` interpolates."""
    return sorted(set(re.findall(r"\$\{([A-Z0-9_]+)", (ROOT / "compose.yaml").read_text())))


def compose_targets(sandbox: Sandbox) -> list[str]:
    """The targets whose dry run calls `docker compose`, found by running each one."""
    return [name for name in targets() if "docker compose" in sandbox.make("-n", name).stdout]


# --- A dry run only prints (INF-M1) ---------------------------------------------------------


@pytest.mark.parametrize("target", ["e2e", "e2e-database", "e2e-drop"])
def test_a_dry_run_runs_nothing_and_prints_no_password(sandbox: Sandbox, target: str) -> None:
    """`make -n` is how a reader previews a recipe. It must not drop, restore or migrate the copy,
    or start the browser suite, and the URL's password must not be printed."""
    result = sandbox.make("-n", target)

    assert result.returncode == 0, output(result)
    assert sandbox.calls() == []
    assert SECRET not in output(result)


# --- Only the copy (UIC-A1) -------------------------------------------------------------------


def test_the_copy_is_migrated_and_tested_through_its_own_name(sandbox: Sandbox) -> None:
    result = sandbox.make("e2e")

    assert result.returncode == 0, output(result)
    [migration] = sandbox.calls_to("uv")
    assert migration.arguments[migration.arguments.index("--database") + 1] == COPY_URL.replace(
        "postgresql://", "postgresql+psycopg://"
    )
    [suite] = sandbox.calls_to("npm")
    assert suite.suite_database == COPY_URL
    for call in sandbox.calls_to("docker"):
        assert re.search(rf"\b{LIVE}\b(?!_e2e)", call.script) is None, call.script


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("E2E_DB", LIVE),
        ("E2E_DATABASE_URL", LIVE_URL),
        ("E2E_YOYO_URL", LIVE_URL.replace("postgresql://", "postgresql+psycopg://")),
        ("E2E_SUITE_URL", LIVE_URL),
    ],
)
def test_the_copy_cannot_be_named_from_the_command_line(
    sandbox: Sandbox, variable: str, value: str
) -> None:
    """The recipes drop, restore and migrate before Playwright's own `_e2e` refusal runs, so a
    name or URL given on the command line is refused before anything is asked."""
    result = sandbox.make("e2e", f"{variable}={value}")

    assert result.returncode != 0
    assert variable in output(result)
    assert sandbox.calls() == []


@pytest.mark.parametrize("variable", ["E2E_DB", "E2E_YOYO_URL", "E2E_SUITE_URL"])
@pytest.mark.parametrize("precedence", [(), ("-e",)], ids=["exported", "make -e"])
def test_the_copy_cannot_be_named_from_the_environment_either(
    sandbox: Sandbox, variable: str, precedence: tuple[str, ...]
) -> None:
    """Under some makes `-e` puts the environment above a target-specific assignment, and the
    URL yoyo migrates is one (RA-1). So the copy's names are refused from anywhere outside."""
    result = sandbox.make(*precedence, "e2e", **{variable: LIVE_URL})

    assert result.returncode != 0
    assert variable in output(result)
    assert sandbox.calls() == []


def with_database_name(sandbox: Sandbox, name: str) -> None:
    env = sandbox.root / ".env"
    env.write_text(env.read_text().replace(f"POSTGRES_DB={LIVE}", f"POSTGRES_DB={name}"))


@pytest.mark.parametrize("target", ["e2e", "e2e-drop"])
@pytest.mark.parametrize("name", ["d" * 60, "d" * 63], ids=["60", "63"])
def test_a_name_whose_copy_postgresql_would_truncate_is_refused(
    sandbox: Sandbox, target: str, name: str
) -> None:
    """PostgreSQL keeps 63 bytes of an identifier and drops the rest, so the copy of a 63-byte
    name *is* the live name, and `dropdb --force` would drop it (RA-3). Bytes, not letters."""
    with_database_name(sandbox, name)

    result = sandbox.make(target)

    assert result.returncode != 0
    assert "63" in output(result)
    assert sandbox.calls() == []


@pytest.mark.parametrize("quote", ['"', "'"], ids=["double", "single"])
def test_a_quoted_name_is_measured_as_the_database_will_be_named(
    sandbox: Sandbox, quote: str
) -> None:
    """dotenv lets a value be quoted. Make keeps the quotes and compose takes them off, so the
    name measured is the one without them (RA-4): 59 bytes plus `_e2e` fits, and the quotes are
    not counted against it."""
    with_database_name(sandbox, quote + "d" * 59 + quote)

    assert sandbox.make("e2e-drop", FAKE_DOCKER_RUNS_SCRIPT="1").returncode == 0
    [drop] = sandbox.calls_to("dropdb")
    assert drop.arguments[-1] == "d" * 59 + "_e2e"


def test_a_quoted_name_whose_copy_would_not_fit_is_still_refused(sandbox: Sandbox) -> None:
    with_database_name(sandbox, '"' + "d" * 60 + '"')

    result = sandbox.make("e2e-drop")

    assert result.returncode != 0
    assert sandbox.calls() == []


#: Names whose copy two shells could read differently, or that make and compose read differently.
NOT_PLAIN = {
    "spaces inside quotes (RE-1)": '"' + "x" * 55 + ' a b c d"',
    "spaces": "app db",
    "accents": "é" * 30,
    "a dollar": "app$db",
    "a backtick": "app`db",
    "an inner quote": "app'db",
    "unmatched quotes": "\"appdb'",
    "two layers of quotes": "'\"appdb\"'",
}


@pytest.mark.parametrize("target", ["e2e", "e2e-drop"])
@pytest.mark.parametrize("name", NOT_PLAIN.values(), ids=NOT_PLAIN.keys())
def test_a_name_that_is_not_plain_is_refused_before_anything_runs(
    sandbox: Sandbox, target: str, name: str
) -> None:
    """**A measurement is only as good as its agreement with what is used.** The guard measures
    the copy's name in make's shell, and the database is handed it by the tools container's, so
    a character the two can read differently lets them disagree. A double-quoted 63-byte name
    with spaces measured 63 bytes and reached `dropdb --force` as 67, which PostgreSQL cuts back
    to the live name (RE-1). So only a plain name -- letters, digits, `_` and `-`, which every
    reader reads alike -- is used, and anything else is refused before any command runs."""
    with_database_name(sandbox, name)

    result = sandbox.make(target, FAKE_DOCKER_RUNS_SCRIPT="1")

    assert result.returncode != 0
    # The phrase, not the word: the sandbox's own path is named after this test.
    assert "not a plain name" in output(result)
    assert sandbox.calls() == []


@pytest.mark.parametrize(
    "written", [LIVE, f'"{LIVE}"', f"'{LIVE}'"], ids=["bare", "double-quoted", "single-quoted"]
)
def test_every_command_and_url_reaches_the_copy_by_the_name_that_was_measured(
    sandbox: Sandbox, written: str
) -> None:
    """The database tools, yoyo and the browser suite all get the copy by one name, its dotenv
    quotes taken off once, as compose takes them off. A quoted name used to keep its quotes in the
    copy's URL, which names no database."""
    with_database_name(sandbox, written)

    result = sandbox.make("e2e", FAKE_DOCKER_RUNS_SCRIPT="1")

    assert result.returncode == 0, output(result)
    handed = [
        argument.removeprefix("--dbname=")
        for call in sandbox.calls()
        if call.tool in DATABASE_TOOLS
        for argument in call.arguments
        if argument == COPY or argument.startswith("--dbname=")
    ]
    assert handed == [COPY] * 4  # dropped, created, restored into, and dropped after the suite
    [migration] = sandbox.calls_to("uv")
    assert migration.arguments[migration.arguments.index("--database") + 1] == COPY_URL.replace(
        "postgresql://", "postgresql+psycopg://"
    )
    [suite] = sandbox.calls_to("npm")
    assert suite.suite_database == COPY_URL


@pytest.mark.parametrize("ignoring", ["make -i", "MAKEFLAGS=i"])
@pytest.mark.parametrize("target", ["e2e", "e2e-database", "e2e-drop"])
@pytest.mark.parametrize(
    "name", ["d" * 63, NOT_PLAIN["spaces inside quotes (RE-1)"]], ids=["too long", "not plain"]
)
def test_an_ignored_error_cannot_get_past_the_refusal(
    sandbox: Sandbox, ignoring: str, target: str, name: str
) -> None:
    """**A refusal that is a failing recipe line can be ignored** (RE-4). `make -i`, or an `i`
    inherited through MAKEFLAGS, ignores every line's failure, and a refusal on a line of its own
    let the next line drop a name PostgreSQL cuts back to the live one. The refusal is make's own
    error instead, part of the very command that would drop, and no flag ignores it."""
    with_database_name(sandbox, name)
    arguments, environment = (["-i"], {}) if ignoring == "make -i" else ([], {"MAKEFLAGS": "i"})

    result = sandbox.make(*arguments, target, FAKE_DOCKER_RUNS_SCRIPT="1", **environment)

    assert result.returncode != 0
    assert "refusing" in output(result)
    assert sandbox.calls() == []


@pytest.mark.parametrize(
    ("variable", "value", "name"),
    [
        ("E2E_FIT", "", "d" * 63),
        ("E2E_PLAIN", "plain", NOT_PLAIN["spaces inside quotes (RE-1)"]),
        ("PG_TOOLS", "docker -c", "d" * 63),
        ("E2E_DROP", f"docker -c 'dropdb --if-exists --force {'d' * 63}_e2e'", "d" * 63),
    ],
    ids=["the guard blanked", "a name called plain", "unguarded tools", "a drop of one's own"],
)
def test_the_refusal_cannot_be_named_away_from_the_command_line(
    sandbox: Sandbox, variable: str, value: str, name: str
) -> None:
    """A command-line value beats a makefile's own, so every piece of the refusal is `override`:
    a value that would have dropped, had it won, changes nothing, and the name is still refused."""
    with_database_name(sandbox, name)

    result = sandbox.make("e2e-drop", f"{variable}={value}", FAKE_DOCKER_RUNS_SCRIPT="1")

    assert result.returncode != 0
    assert sandbox.calls_to("dropdb") == []


def test_a_name_whose_copy_fits_is_used(sandbox: Sandbox) -> None:
    with_database_name(sandbox, "d" * 59)

    assert sandbox.make("e2e-drop").returncode == 0
    [drop] = sandbox.calls_to("docker")
    assert drop.script == f"dropdb --if-exists --force {'d' * 59}_e2e"


# --- Compose reads .env, never the command line (INF-G2) --------------------------------------


def test_every_compose_target_refuses_a_command_line_port(sandbox: Sandbox) -> None:
    """GNU make exports a command-line variable to the recipe, and compose prefers it to `.env`:
    `make e2e DATABASE_PORT=1` recreated the live database on port 1. Found by running each
    target, so a target added later is held to the same rule."""
    found = compose_targets(sandbox)
    assert {"backup", "docker-migrate", "e2e", "migrate", "schema-diagram", "up"} <= set(found)

    accepted = [
        name for name in found if sandbox.make("-n", name, "DATABASE_PORT=1").returncode == 0
    ]

    assert accepted == []


@pytest.mark.parametrize("variable", compose_variables())
def test_no_variable_compose_interpolates_is_taken_from_the_command_line(
    sandbox: Sandbox, variable: str
) -> None:
    result = sandbox.make("-n", "backup", f"{variable}=from-the-command-line")

    assert result.returncode != 0
    assert variable in output(result)


@pytest.mark.parametrize("precedence", [("-e",), ()], ids=["make -e", "MAKEFLAGS=e"])
def test_an_environment_that_make_lets_win_is_refused_too(
    sandbox: Sandbox, precedence: tuple[str, ...]
) -> None:
    """Under `-e` the environment beats .env, so `DATABASE_PORT=1 make -e backup` reached compose
    as surely as the command line did (RA-2)."""
    flags = {} if precedence else {"MAKEFLAGS": "e"}

    result = sandbox.make("-n", *precedence, "backup", DATABASE_PORT="1", **flags)

    assert result.returncode != 0
    assert "DATABASE_PORT" in output(result)


def test_a_target_that_never_calls_compose_still_takes_command_line_values(
    sandbox: Sandbox,
) -> None:
    """The guard is on compose, not on make: pointing the tests at another database stays legal."""
    assert sandbox.make("-n", "test", "DATABASE_PORT=5433").returncode == 0


def test_the_suites_tools_never_start_or_recreate_the_database(sandbox: Sandbox) -> None:
    """`--no-deps`: a one-off tools container, and compose never reconciles the database service
    -- not even after `.env` was edited without restarting the stack."""
    assert sandbox.make("e2e").returncode == 0

    docker = sandbox.calls_to("docker")
    assert docker
    for call in docker:
        assert call.arguments[:2] == ("compose", "--profile")
        assert "run" in call.arguments
        assert "--no-deps" in call.arguments
        assert "up" not in call.arguments


def test_no_tools_container_touches_the_database_but_the_migration(sandbox: Sandbox) -> None:
    """A one-off tools container that names the database as a dependency makes compose reconcile
    it -- start it, or recreate it to match whatever configuration reached compose. Only
    `docker-migrate` keeps its dependency, because its compose-level backup is what makes the
    migration safe (ST-20); starting the stack is `up`'s whole purpose."""
    reconciling = {
        name: line
        for name in compose_targets(sandbox)
        if name != "docker-migrate"
        for line in sandbox.make("-n", name).stdout.splitlines()
        if "docker compose" in line and " run " in line and "--no-deps" not in line
    }

    assert reconciling == {}


def test_the_backup_is_taken_without_touching_the_database_container(sandbox: Sandbox) -> None:
    assert sandbox.make("backup").returncode == 0

    [backup] = sandbox.calls_to("docker")
    assert "--no-deps" in backup.arguments
    assert backup.arguments[-1] == "backup"


# --- A cleanup that fails says so (INF-M2) ----------------------------------------------------


def test_a_drop_that_fails_fails_even_a_passing_suite(sandbox: Sandbox) -> None:
    result = sandbox.make("e2e", FAKE_DOCKER_FAIL_SCRIPT=DROP_ONLY)

    assert result.returncode != 0
    assert "make e2e-drop" in output(result)


def test_a_failing_suite_still_fails_and_is_still_dropped(sandbox: Sandbox) -> None:
    result = sandbox.make("e2e", FAKE_NPM_EXIT="3")

    assert result.returncode != 0
    assert sandbox.calls()[-1].script == DROP_ONLY


def test_a_failed_restore_drops_the_copy_and_says_so(sandbox: Sandbox) -> None:
    result = sandbox.make("e2e", FAKE_DOCKER_FAIL_CONTAINS="pg_restore")

    assert result.returncode != 0
    assert "so it was dropped" in output(result)
    assert sandbox.calls()[-1].script == DROP_ONLY
    assert sandbox.calls_to("uv") == []
    assert sandbox.calls_to("npm") == []


def test_a_failed_restore_whose_drop_fails_too_says_how_to_finish(sandbox: Sandbox) -> None:
    result = sandbox.make(
        "e2e", FAKE_DOCKER_FAIL_CONTAINS="pg_restore", FAKE_DOCKER_FAIL_SCRIPT=DROP_ONLY
    )

    assert result.returncode != 0
    assert "make e2e-drop" in output(result)
    assert "so it was dropped" not in output(result)


# --- The live database's own targets (S1, S2) ---------------------------------------------------


@pytest.mark.parametrize("target", ["migrate", "rollback"])
@pytest.mark.parametrize("preview", [(), ("-n",)], ids=["run", "make -n"])
def test_a_migration_is_left_to_the_script_and_never_prints_the_password(
    sandbox: Sandbox, target: str, preview: tuple[str, ...]
) -> None:
    """The URL is read and handed to yoyo by `tools/migrate.py` (RF-1), so make never holds it:
    neither a run nor a preview shows the password (S1), and it is on no command line."""
    command = "apply" if target == "migrate" else "rollback"

    result = sandbox.make(*preview, target)

    assert result.returncode == 0, output(result)
    assert SECRET not in output(result)
    if not preview:
        [migration] = sandbox.calls_to("uv")
        assert migration.arguments == ("run", "python", "../tools/migrate.py", command)


def test_help_lists_every_target_that_documents_itself(sandbox: Sandbox) -> None:
    """A target with a `##` line is one `make help` promises to list, and the four whose names
    hold a digit -- `e2e` and its kin -- were missing from it (S2)."""
    documented = set(
        re.findall(r"^([A-Za-z0-9_-]+):[^=\n]*## ", (ROOT / "Makefile").read_text(), re.MULTILINE)
    )
    listed = sandbox.make("help").stdout
    shown = set(re.findall(r"^\s+([A-Za-z0-9_-]+)\s", re.sub(r"\x1b\[[0-9;]*m", "", listed), re.M))

    assert {"e2e", "e2e-database", "e2e-drop", "migrate"} <= documented
    assert documented - shown == set()
