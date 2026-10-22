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
    case "$last" in *"${FAKE_DOCKER_FAIL_CONTAINS:-@never@}"*) exit 1 ;; esac ;;
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
        for tool in ("docker", "uv", "npm"):
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
