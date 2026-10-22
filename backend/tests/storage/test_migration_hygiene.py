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

import psycopg
import pytest
from yoyo.migrations import read_sql_migration

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"

#: The first migration has no predecessor to name, which is what makes it the first.
THE_ROOT = "0001-reference-tables"


def forward_migrations() -> list[Path]:
    return sorted(p for p in MIGRATIONS.glob("*.sql") if not p.name.endswith(".rollback.sql"))


def predecessors_yoyo_can_see(migration: Path) -> list[str]:
    """The predecessors `yoyo` will actually act on, read with `yoyo`'s own parser.

    **Asking the file for the string `-- depends: ` is a different question**, and the gap
    between the two shipped twice: `parse_metadata_from_sql_comments` reads directives only
    from the leading comment block of the *first* statement and stops at the first line that
    is not a comment, so a `depends:` written further down the file is prose. `0483` and `0484`
    each carried one below an `ALTER TABLE`, and a test that searched the text passed while
    `yoyo` had no predecessor for either and fell back to filename order.

    Splitting on whitespace is `yoyo`'s own rule for the directive's value, so more than one
    predecessor reads here exactly as it does there.
    """
    directives, _leading_comment, _statements = read_sql_migration(str(migration))
    return directives.get("depends", "").split()


def test_there_are_migrations_to_check() -> None:
    """Guards the tests below: a glob that matched nothing would pass them all."""
    assert len(forward_migrations()) > 50


@pytest.mark.parametrize("migration", forward_migrations(), ids=lambda p: p.stem)
def test_every_migration_names_the_one_it_follows(migration: Path) -> None:
    if migration.stem == THE_ROOT:
        return
    assert predecessors_yoyo_can_see(migration) != [], (
        f"{migration.name} states no predecessor `yoyo` can see, so its position in the chain "
        "is whatever sorting the filenames happens to give. A `-- depends:` line below the "
        "first statement does not count: `yoyo` stops reading directives at the first line of "
        "SQL, so it must sit in the leading comment block at the top of the file"
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
    for named in predecessors_yoyo_can_see(migration):
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


def rollbacks_that_delete_figures() -> list[Path]:
    """Rollbacks with a `DELETE FROM value`, which is the statement that needs company.

    `(?!_)` keeps `value_citation` and the ten magnitude tables out: those are the rows this
    test is asking about, not the ones it is looking for.
    """
    deletes_a_figure = re.compile(r"\bdelete\s+from\s+value\b(?!_)", re.I)
    return sorted(
        p
        for p in MIGRATIONS.glob("*.rollback.sql")
        if deletes_a_figure.search(re.sub(r"^\s*--.*$", "", p.read_text(), flags=re.M))
    )


def test_there_are_rollbacks_that_delete_figures() -> None:
    """Guards the test below, which a glob that matched nothing would pass silently."""
    assert len(rollbacks_that_delete_figures()) >= 3


@pytest.mark.parametrize(
    "rollback", rollbacks_that_delete_figures(), ids=lambda p: p.name.removesuffix(".rollback.sql")
)
def test_a_rollback_clears_a_figures_own_rows_before_the_figure(
    rollback: Path, connection: psycopg.Connection
) -> None:
    """**Eleven tables reference `value` and not one of them cascades.**

    A figure's magnitude lives in `value_<type>` and the pages it came from live in
    `value_citation`, so `DELETE FROM value` on its own fails with a `ForeignKeyViolation` the
    moment any figure has actually been acquired. `0470`, `0488` and `0489` all shipped that
    way and all three were walls on any real database -- `0470` on 310 rows, `0488` on 211,
    `0489` on 32 -- while masking `0478`'s carefully written refusal, which sits downstream of
    them and could never be reached.

    **Nothing we had could catch it.** The test database is rebuilt from migrations and holds
    no figures, so the delete matches nothing and the rollback runs; `make live` does not roll
    back. The fault is only visible against stored data, which is why it is checked here as
    text instead.

    `candidate_attribute_score` is deliberately **not** required. A saved evaluation is a frozen
    record that must still explain its score (`0107`), so its foreign key *should* refuse a
    rollback that would empty one, rather than be cleared out of the way.
    """
    dependents = {
        row[0]
        for row in connection.execute(
            "SELECT DISTINCT tc.table_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.constraint_column_usage ccu "
            "  ON tc.constraint_name = ccu.constraint_name "
            "WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'value' "
            "  AND tc.table_name LIKE 'value\\_%'"
        ).fetchall()
    }
    assert dependents, "no table was found referencing `value`, so this test proves nothing"

    cleared = tables_written_by(rollback.read_text()) & dependents
    magnitude_tables = dependents - {"value_citation"}

    assert "value_citation" in cleared, (
        f"{rollback.name} deletes figures but never clears `value_citation`, so it fails on "
        "`value_citation_value_fkey` for any figure that recorded the page it came from"
    )
    assert cleared & magnitude_tables, (
        f"{rollback.name} deletes figures but clears none of {sorted(magnitude_tables)}, and "
        "every stored figure has exactly one magnitude row, so this fails on that table's "
        "foreign key as soon as a figure exists"
    )


#: The modes that conflict with ROW EXCLUSIVE, the lock every INSERT, UPDATE and DELETE takes. Held,
#: one waits for any write already in flight and holds off any new one until the transaction ends.
WRITER_BLOCKING_MODES = frozenset({"share", "share row exclusive", "exclusive", "access exclusive"})


def without_comments(sql: str) -> str:
    return re.sub(r"^\s*--.*$", "", sql, flags=re.M)


def tables_read_by(statement: str) -> set[str]:
    named = re.findall(r"\b(?:from|join)\s+\"?([a-z_]+)\"?", statement, re.I)
    return {name.lower() for name in named}


LOCK_STATEMENT = re.compile(
    r"^\s*lock\s+(?:table\s+)?(?:only\s+)?(.+?)"
    r"(?:\s+in\s+([a-z ]+?)\s+mode)?(?:\s+nowait)?\s*;",
    re.I | re.M | re.S,
)


def locks_taken(sql: str) -> list[tuple[int, str, set[str]]]:
    """Every `LOCK` statement: where it starts, the mode it takes, and the tables it names.

    A `LOCK` that names no mode takes ACCESS EXCLUSIVE, PostgreSQL's default.
    """
    return [
        (
            match.start(),
            " ".join((match.group(2) or "access exclusive").lower().split()),
            {name.strip().strip('"').lower() for name in match.group(1).split(",")},
        )
        for match in LOCK_STATEMENT.finditer(sql)
    ]


def reads_unlocked(sql: str, reads: list[tuple[int, set[str]]]) -> set[str]:
    """The tables in `reads` that no writer-blocking lock taken earlier in `sql` covers."""
    locks = locks_taken(sql)
    unlocked: set[str] = set()
    for position, tables in reads:
        held = {
            table
            for taken_at, mode, named in locks
            if taken_at < position and mode in WRITER_BLOCKING_MODES
            for table in named
        }
        unlocked |= tables - held
    return unlocked


def counts_in(sql: str) -> list[tuple[int, set[str]]]:
    """Every `count(*)` statement, and the tables it reads: the evidence a refusal decides on."""
    return [
        (match.start(), tables_read_by(match.group(0)))
        for match in re.finditer(r"\bcount\s*\(\s*\*\s*\)[^;]*;", sql, re.I)
    ]


def lifts_in(sql: str) -> list[tuple[int, set[str]]]:
    """Every temp table filled from a real one, and the tables it is filled from."""
    lifts = [
        (match.start(), tables_read_by(match.group(0)))
        for match in re.finditer(r"\bcreate\s+temp(?:orary)?\s+table\b[^;]*;", sql, re.I)
    ]
    return [(position, tables) for position, tables in lifts if tables]


def rollbacks_that_refuse() -> list[Path]:
    return sorted(
        p
        for p in MIGRATIONS.glob("*.rollback.sql")
        if re.search(r"\braise\s+exception\b", without_comments(p.read_text()), re.I)
    )


def migrations_that_lift_rows() -> list[Path]:
    return sorted(p for p in MIGRATIONS.glob("*.sql") if lifts_in(without_comments(p.read_text())))


def test_there_are_rollbacks_that_refuse_and_migrations_that_lift() -> None:
    """Guards the two tests below, which a glob that matched nothing would pass silently."""
    assert len(rollbacks_that_refuse()) >= 4
    assert len(migrations_that_lift_rows()) >= 6


@pytest.mark.parametrize(
    "rollback", rollbacks_that_refuse(), ids=lambda p: p.name.removesuffix(".rollback.sql")
)
def test_a_refusing_rollback_locks_what_it_counts_before_counting(rollback: Path) -> None:
    """**A refusal decided on a count is only as good as the count** (BE-A1).

    A rollback that refuses over recorded history -- a billed call, a hand-entered answer, a
    stored figure -- counts it first and acts on the count. `count(*)` takes ACCESS SHARE, which
    stops no writer: a row committed between the count and the act is one the refusal never saw.
    `0503` dropped its table over such a row, and the others met a raw foreign-key error instead
    of their own refusal. Locking every counted table in a mode that conflicts with ROW EXCLUSIVE,
    *before* the count, makes the count final: a write in flight lands first and is counted, and
    none can land after until the rollback commits.

    `test_rollback_races` shows each lock doing this against a real write; this holds every
    rollback that refuses, including any written later, to the same rule.
    """
    sql = without_comments(rollback.read_text())
    counted = counts_in(sql)
    assert counted, f"{rollback.name} refuses on something other than a count; read it by hand"

    unlocked = reads_unlocked(sql, counted)

    assert unlocked == set(), (
        f"{rollback.name} counts {sorted(unlocked)} without first locking "
        f"{'them' if len(unlocked) > 1 else 'it'} in one of {sorted(WRITER_BLOCKING_MODES)}, so "
        "a row committed between the count and the act escapes the refusal"
    )


@pytest.mark.parametrize("migration", migrations_that_lift_rows(), ids=lambda p: p.stem)
def test_a_migration_locks_a_table_before_lifting_its_rows(migration: Path) -> None:
    """**A copy taken to be put back must be the last word on what it copied** (BE-A1).

    A retype lifts a criterion's rows into a temp table, deletes them, and inserts the copy back
    once the attribute has moved. A set edit committed between the copy and the delete is
    deleted with the rest and replaced by the copy taken before it: the edit is lost, and its
    pillar's weights may no longer sum to 100. Locking the table first, in a mode that conflicts
    with ROW EXCLUSIVE, makes the copy final -- an edit in flight lands first and is copied, and
    none can land after until the migration commits.

    Forward migrations are held to it as well as rollbacks: `make migrate` runs while the backend
    may be serving edits, exactly as `make rollback` does.
    """
    sql = without_comments(migration.read_text())

    unlocked = reads_unlocked(sql, lifts_in(sql))

    assert unlocked == set(), (
        f"{migration.name} copies rows of {sorted(unlocked)} to put back later without first "
        f"locking {'them' if len(unlocked) > 1 else 'it'} in one of "
        f"{sorted(WRITER_BLOCKING_MODES)}, so a write committed after the copy is lost"
    )
