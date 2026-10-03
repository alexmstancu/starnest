"""What every migration must carry, checked as a set rather than one at a time.

**A migration is the only way the schema and the catalog change** (`arch.md` 1.2), and the two
things that make the set replayable -- a stated predecessor and a way back -- are easy to leave
off and invisible when you do. `yoyo` falls back to filename order without a `depends:` line, so
a missing one costs nothing until two migrations land out of order and then costs everything.

Found missing on `0482`, `0483` and `0484` by a review, days after they shipped, because nothing
looked.
"""

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"

#: The first migration has no predecessor to name, which is what makes it the first.
THE_ROOT = "0001-reference-tables"


def forward_migrations() -> list[Path]:
    return sorted(p for p in MIGRATIONS.glob("*.sql") if not p.name.endswith(".rollback.sql"))


def test_there_are_migrations_to_check() -> None:
    """Guards the two tests below: a glob that matched nothing would pass them both."""
    assert len(forward_migrations()) > 50


@pytest.mark.parametrize("migration", forward_migrations(), ids=lambda p: p.stem)
def test_every_migration_names_the_one_it_follows(migration: Path) -> None:
    if migration.stem == THE_ROOT:
        return
    assert "-- depends: " in migration.read_text(), (
        f"{migration.name} states no predecessor, so its position in the chain is whatever "
        "sorting the filenames happens to give"
    )


@pytest.mark.parametrize("migration", forward_migrations(), ids=lambda p: p.stem)
def test_every_migration_has_a_way_back(migration: Path) -> None:
    rollback = migration.with_name(f"{migration.stem}.rollback.sql")
    assert rollback.exists(), (
        f"{migration.name} has no rollback. `make migrate` backs up first, but a backup "
        "restores the whole database where a rollback undoes one step"
    )


@pytest.mark.parametrize("migration", forward_migrations(), ids=lambda p: p.stem)
def test_the_predecessor_named_is_a_migration_that_exists(migration: Path) -> None:
    """A typo in the name is the failure this catches: `yoyo` would refuse to apply the set,
    and it would refuse at the moment somebody is trying to migrate rather than here.

    **More than one predecessor is legal**, space separated -- `0120` follows both the nesting
    rule and the country code, because it needs what each of them added.
    """
    if migration.stem == THE_ROOT:
        return
    for line in migration.read_text().splitlines():
        if line.startswith("-- depends: "):
            for named in line.removeprefix("-- depends: ").split():
                assert (MIGRATIONS / f"{named}.sql").exists(), (
                    f"{migration.name} depends on {named!r}, which is not a migration"
                )


def tables_written_by(sql: str) -> set[str]:
    """Every table the statement writes to, by name.

    Comments are stripped first: these migrations carry long explanatory headers that name
    tables in prose, and a comment is not a write.
    """
    without_comments = re.sub(r"^\s*--.*$", "", sql, flags=re.M)
    # `DO UPDATE SET` inside an upsert is not a write to a table called "set", and `UPDATE` as
    # a bare keyword appears there too -- so the upsert clause goes before anything is matched.
    without_upserts = re.sub(
        r"on\s+conflict.*?do\s+update", " ", without_comments, flags=re.I | re.S
    )
    # A TEMP table lives and dies inside the transaction, so nothing has to undo it.
    temporary = set(
        re.findall(r"create\s+temp(?:orary)?\s+table\s+\"?([a-z_]+)\"?", without_upserts, re.I)
    )
    without_temps = re.sub(
        r"create\s+temp(?:orary)?\s+table\s+\"?[a-z_]+\"?", " ", without_upserts, flags=re.I
    )
    written = re.findall(
        r"(?:insert\s+into|update|delete\s+from|alter\s+table|"
        r"create\s+table(?:\s+if\s+not\s+exists)?|drop\s+table(?:\s+if\s+exists)?)"
        r"\s+\"?([a-z_]+)\"?",
        without_temps,
        re.I,
    )
    return {name.lower() for name in written} - {"set", "only"} - temporary


@pytest.mark.parametrize("migration", forward_migrations(), ids=lambda p: p.stem)
def test_a_rollback_touches_every_table_its_migration_wrote(migration: Path) -> None:
    """**A rollback that never mentions a table cannot undo what was done to it.**

    Proving a rollback truly inverts would mean applying and reversing each one against a real
    database, which is slow and would have to run in order. This is the cheap half of the same
    question, and it catches the failure that actually happens: a migration grows a second
    statement and the rollback is not updated with it. `0488` shipped exactly that way for an
    hour -- it added an attribute, a quantity parameter, a source priority, a stand-in and two
    criteria, and the first rollback undid some of them.

    A rollback may legitimately touch *more* tables than its migration; it may not touch fewer.
    """
    rollback = migration.with_name(f"{migration.stem}.rollback.sql")
    if not rollback.exists():
        return  # the test above owns that failure, and says it better

    forgotten = tables_written_by(migration.read_text()) - tables_written_by(rollback.read_text())

    assert forgotten == set(), (
        f"{migration.name} writes to {sorted(forgotten)} and its rollback never mentions "
        f"{'them' if len(forgotten) > 1 else 'it'}, so reversing it would leave that behind."
    )
