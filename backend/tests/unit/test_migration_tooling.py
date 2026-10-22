"""Every way of migrating the schema takes a backup first (`arch.md` 9.5, ST-20).

**What is being protected is specific.** Structured figures can be fetched again slowly and LLM
figures for money, but a value typed by hand -- a visa verdict, a quota answer -- exists in one
place. `make migrate` has always backed up first; `make docker-migrate` ran compose's `migrate`
service, which depended on the database alone, and `make rollback` -- several of whose scripts
delete stored figures -- backed up nothing.

Read from the files themselves rather than by running them: no test here may start a container
or touch a database, and what is under test is a declaration, which a parse states exactly.
"""

import re
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[3]

TARGET_SPECIFIC_VARIABLE = re.compile(
    r"^[A-Za-z0-9_ -]+:\s*(?:(?:export|override|private)\s+)*[A-Za-z_][A-Za-z0-9_]*\s*[:+?]?="
)


def compose_services() -> dict[str, Any]:
    return yaml.safe_load((ROOT / "compose.yaml").read_text())["services"]


def make_targets(makefile: str | None = None) -> dict[str, tuple[list[str], list[str]]]:
    """Each Makefile target, as its prerequisites and its recipe lines.

    Enough of make for the shape this Makefile uses: a target line is a name, a colon and an
    optional `## help`; its recipe is the tab-indented lines that follow it. `:=` assignments
    are variables, not targets, and so is a target-specific one (`e2e: export X := ...`), which
    names a target without declaring its rule.
    """
    targets: dict[str, tuple[list[str], list[str]]] = {}
    current: str | None = None
    text = (ROOT / "Makefile").read_text() if makefile is None else makefile
    for line in text.splitlines():
        if TARGET_SPECIFIC_VARIABLE.match(line):
            current = None
            continue
        declared = re.match(r"^([A-Za-z0-9_-]+):(?!=)([^#]*)", line)
        if declared:
            current = declared.group(1)
            targets[current] = (declared.group(2).split(), [])
        elif line.startswith("\t") and current is not None:
            targets[current][1].append(line.strip())
        elif line.strip():
            current = None
    return targets


def test_the_container_migration_waits_for_a_successful_backup() -> None:
    """ST-20. Compose starts `migrate` only once the dump has been written, and a dump that
    failed stops the migration -- including a bare `docker compose run migrate`, which no
    Makefile target guards."""
    waits_for = compose_services()["migrate"]["depends_on"]

    assert waits_for.get("backup") == {"condition": "service_completed_successfully"}


def test_the_backup_it_waits_for_is_a_tool_like_itself() -> None:
    """Both one-shot services stay behind the `tools` profile, so the dependency is there
    whenever `migrate` is, and `docker compose up` never takes a dump on its own."""
    services = compose_services()

    assert "tools" in services["migrate"]["profiles"]
    assert "tools" in services["backup"]["profiles"]


def test_every_make_target_that_runs_yoyo_backs_up_first() -> None:
    """NEW-20. A rollback changes the schema as surely as a migration does, and at least three
    rollback scripts delete stored figures.

    `e2e-database` is exempt: it runs yoyo against a throwaway copy it restores from the newest
    backup and drops afterwards (UI-03), never the live database, so there is nothing of the
    household's to back up first -- the copy already is a backup.
    """
    running_yoyo = {
        name: prerequisites
        for name, (prerequisites, recipe) in make_targets().items()
        if any(re.search(r"\byoyo (apply|rollback)\b", line) for line in recipe)
    }
    against_the_live_database = {
        name: prerequisites
        for name, prerequisites in running_yoyo.items()
        if name != "e2e-database"
    }

    assert sorted(against_the_live_database) == ["migrate", "rollback"]
    assert {
        name
        for name, prerequisites in against_the_live_database.items()
        if "backup" not in prerequisites
    } == set()


def test_the_container_migration_makes_the_backup_directory_before_it_runs() -> None:
    """The dump lands in `./backups` through a bind mount, which Docker would otherwise create
    owned by whoever runs the daemon -- the same reason `make backup` creates it first."""
    _, recipe = make_targets()["docker-migrate"]
    migrating = next(i for i, line in enumerate(recipe) if re.search(r"\brun\b.*\bmigrate$", line))

    assert any("mkdir -p backups" in line for line in recipe[:migrating])


def test_the_backup_still_writes_a_custom_format_dump() -> None:
    """The format `pg_restore` reads, into the directory the bind mount shares with the host --
    what the dependency above is worth only if it stays true."""
    backup = compose_services()["backup"]

    assert "pg_dump --format=custom --file=/backups/" in backup["command"]
    assert "./backups:/backups" in backup["volumes"]


def test_a_target_specific_variable_is_not_read_as_a_rule() -> None:
    """`e2e-database: export E2E_YOYO_URL := ...` names a target without declaring its rule. Read
    as one, a line after the rule would have replaced its prerequisites and recipe, and the yoyo
    the recipe runs would have dropped out of the backup check above without failing it."""
    rule_then_variable = (
        "e2e-database:  ## A copy\n"
        "\tuv run yoyo apply --batch\n"
        "\n"
        "e2e-database: export E2E_YOYO_URL := postgresql+psycopg://u@h/db_e2e\n"
    )

    prerequisites, recipe = make_targets(rule_then_variable)["e2e-database"]

    assert prerequisites == []
    assert recipe == ["uv run yoyo apply --batch"]


def test_the_real_makefile_keeps_its_e2e_rules_whole() -> None:
    targets = make_targets()

    assert targets["e2e"][0] == ["e2e-database"]
    assert any(re.search(r"\byoyo apply\b", line) for line in targets["e2e-database"][1])
