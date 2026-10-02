"""What every migration must carry, checked as a set rather than one at a time.

**A migration is the only way the schema and the catalog change** (`arch.md` 1.2), and the two
things that make the set replayable -- a stated predecessor and a way back -- are easy to leave
off and invisible when you do. `yoyo` falls back to filename order without a `depends:` line, so
a missing one costs nothing until two migrations land out of order and then costs everything.

Found missing on `0482`, `0483` and `0484` by a review, days after they shipped, because nothing
looked.
"""

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
