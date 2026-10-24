"""What every migration must carry, checked as a set rather than one at a time.

**A migration is the only way the schema and the catalog change** (`arch.md` 1.2), and the two
things that make the set replayable -- a stated predecessor and a way back -- are easy to leave
off and invisible when you do. `yoyo` falls back to filename order without a `depends:` line, so
a missing one costs nothing until two migrations land out of order and then costs everything.

Found missing on `0482`, `0483` and `0484` by a review, days after they shipped, because nothing
looked.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
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

LOCK_STATEMENT = re.compile(
    r"^\s*lock\s+(?:table\s+)?(?:only\s+)?(.+?)"
    r"(?:\s+in\s+([a-z ]+?)\s+mode)?(?:\s+nowait)?\s*$",
    re.I | re.S,
)


#: What opens a dollar-quoted string: `$$`, or a tag spelled like a name between two dollars.
DOLLAR_QUOTE = re.compile(r"\$(?:[^\W\d]\w*)?\$")

#: What carries a string on to its next quote: a newline, with only spaces and comments about it.
CONTINUATION = re.compile(r"(?:[ \t\f]|--[^\n\r]*)*[\n\r](?:\s|--[^\n\r]*[\n\r])*'")


def code_of(sql: str) -> str:
    """The SQL with its comments removed and its literals emptied.

    **A table named in prose is not a table read.** Comments run to whole paragraphs here, and a
    refusal's message says "restore from the backup", which a reader of `FROM <name>` takes for a
    table called `the`. A `DO $$` block's body stays: it is code, and it is the code a refusal
    decides with. Every other dollar quote is a string, and is emptied like one -- a block opened
    any other way is refused below, whatever its body holds.

    **A literal ends where PostgreSQL ends it** (P98). A quote inside `$$...$$` ends nothing, nor
    does a backslashed one in `E'...'`, nor one in a quoted name: taken for an end, each turned
    the statements after it into the inside of a string, which every check here passed unread.
    """
    kept: list[str] = []
    at = 0
    while at < len(sql):
        if sql.startswith("--", at):
            end = sql.find("\n", at)
            at = len(sql) if end < 0 else end
        elif sql.startswith("/*", at):
            end = sql.find("*/", at + 2)
            at = len(sql) if end < 0 else end + 2
            kept.append(" ")
        elif sql[at] == '"':
            end = past_closing_quote(sql, at)
            kept.append(sql[at:end])
            at = end
        elif sql[at] == "'" or opens_an_escape_string(sql, at):
            escapes = sql[at] != "'"
            at = past_closing_quote(sql, at + 1 if escapes else at, escapes=escapes)
            kept.append("''")
        elif (dollars := dollar_quote_at(sql, at)) is not None:
            closing = sql.find(dollars, at + len(dollars))
            closing = len(sql) if closing < 0 else closing
            if dollars == "$$" and re.search(r"\bdo\s+\Z", "".join(kept), re.I):
                kept.append(f"$${code_of(sql[at + 2 : closing])}$$")
            else:
                kept.append("''")
            at = closing + len(dollars)
        else:
            kept.append(sql[at])
            at += 1
    return "".join(kept)


def continues_a_name(sql: str, at: int) -> bool:
    """Whether `sql[at]` carries on the name before it, as `$` and `E` can: then neither opens a
    literal -- `price$$` is a name, and `ELSE'...'` no escape string."""
    return at > 0 and (sql[at - 1].isalnum() or sql[at - 1] in "_$")


def opens_an_escape_string(sql: str, at: int) -> bool:
    return sql[at] in "eE" and sql.startswith("'", at + 1) and not continues_a_name(sql, at)


def dollar_quote_at(sql: str, at: int) -> str | None:
    """The `$tag$` that opens a dollar-quoted string at `at`, if one does."""
    opening = DOLLAR_QUOTE.match(sql, at)
    return opening.group(0) if opening and not continues_a_name(sql, at) else None


def past_closing_quote(sql: str, opening: int, *, escapes: bool = False) -> int:
    """Just past the quote that closes the one at `opening`.

    A doubled quote closes nothing. With `escapes`, as in `E'...'`, neither does a backslashed
    one, and a string closed at the end of a line and opened again on the next is one string.
    """
    quote = sql[opening]
    at = opening + 1
    while at < len(sql):
        if (escapes and sql[at] == "\\") or sql.startswith(quote * 2, at):
            at += 2
        elif sql[at] != quote:
            at += 1
        elif escapes and (carried := CONTINUATION.match(sql, at + 1)):
            at = carried.end()
        else:
            return at + 1
    return len(sql)


def statements_in(code: str) -> list[str]:
    """`code` cut at every semicolon, a `DO` block's too: each piece still reads what it read."""
    return [piece for piece in (part.strip() for part in code.split(";")) if piece]


def tables_read_by(statement: str) -> set[str]:
    named = re.findall(r"\b(?:from|join)\s+(?:only\s+)?\"?([a-z_]+)\"?", statement, re.I)
    return {name.lower() for name in named}


def tables_changed_by(statement: str) -> set[str]:
    named = re.findall(r"\b(?:delete\s+from|update)\s+(?:only\s+)?\"?([a-z_]+)\"?", statement, re.I)
    return {name.lower() for name in named} - {"set"}


def locked_first(code: str) -> set[str]:
    """The tables locked, in a mode that holds off writers, before anything else is done.

    **First, not merely before.** Under READ COMMITTED a lock taken just before a read is enough,
    since each statement takes its own snapshot; under REPEATABLE READ the snapshot is the first
    statement's, and a lock after it guards a read that may already be stale. Locks first holds
    under either, and reads as what it is: the migration claims what it will decide on.
    """
    held: set[str] = set()
    for statement in statements_in(code):
        lock = LOCK_STATEMENT.match(statement)
        if lock is None:
            break
        mode = " ".join((lock.group(2) or "access exclusive").lower().split())
        if mode in WRITER_BLOCKING_MODES:
            held |= {
                name.strip().strip('"').rstrip("*").strip().lower()
                for name in lock.group(1).split(",")
            }
    return held


def read_by_a_refusal(code: str) -> set[str]:
    """Every table a `DO` block that raises reads: the evidence a refusal decides on."""
    return {
        table
        for block in re.findall(r"\bdo\s+\$\$(.*?)\$\$", code, re.I | re.S)
        if re.search(r"\braise\s+exception\b", block, re.I)
        for table in tables_read_by(block)
    }


def copied_then_changed(code: str) -> set[str]:
    """Every table rows are copied from and that the same migration then deletes from or updates.

    A copy is any statement that writes rows it selects -- `INSERT ... SELECT`, `CREATE [TEMP]
    TABLE ... AS SELECT` -- whatever it writes into: a temp table filled later is a copy too.
    """
    statements = statements_in(code)
    copied_changed: set[str] = set()
    for position, statement in enumerate(statements):
        writes_rows = re.match(
            r"(?:insert\s+into|create\s+(?:temp(?:orary)?\s+)?table)\b", statement, re.I
        )
        if writes_rows is None or not re.search(r"\bselect\b", statement, re.I):
            continue
        changed_later = set().union(*(tables_changed_by(s) for s in statements[position + 1 :]))
        copied_changed |= tables_read_by(statement) & changed_later
    return copied_changed


def unlocked_refusal_reads(sql: str) -> set[str]:
    code = code_of(sql)
    return read_by_a_refusal(code) - locked_first(code)


def unlocked_copies(sql: str) -> set[str]:
    code = code_of(sql)
    return copied_then_changed(code) - locked_first(code)


def rollbacks_that_refuse() -> list[Path]:
    return sorted(
        p for p in MIGRATIONS.glob("*.rollback.sql") if read_by_a_refusal(code_of(p.read_text()))
    )


def migrations_that_copy_then_change() -> list[Path]:
    return sorted(
        p for p in MIGRATIONS.glob("*.sql") if copied_then_changed(code_of(p.read_text()))
    )


def test_there_are_rollbacks_that_refuse_and_migrations_that_copy() -> None:
    """Guards the two tests below, which a glob that matched nothing would pass silently."""
    assert len(rollbacks_that_refuse()) >= 4
    assert len(migrations_that_copy_then_change()) >= 13


@pytest.mark.parametrize(
    "rollback", rollbacks_that_refuse(), ids=lambda p: p.name.removesuffix(".rollback.sql")
)
def test_a_refusing_rollback_locks_what_its_refusal_reads(rollback: Path) -> None:
    """**A refusal is only as good as the read it decides on** (BE-A1).

    A rollback that refuses over recorded history -- a billed call, a hand-entered answer, a
    stored figure -- reads it first and acts on what it read. A read takes ACCESS SHARE, which
    stops no writer: a row committed between the read and the act is one the refusal never saw.
    `0503` dropped its table over such a row, and the others met a raw foreign-key error instead
    of their own refusal. Every table the refusal reads is locked, in a mode that holds off
    writers, before anything else: a write in flight lands first and is counted, and none can
    land after until the rollback commits.

    `test_rollback_races` shows the locks doing this against real writes; this holds every
    rollback that refuses, including any written later, to the same rule.
    """
    unlocked = unlocked_refusal_reads(rollback.read_text())

    assert unlocked == set(), (
        f"{rollback.name} refuses on what it reads of {sorted(unlocked)} without first locking "
        f"{'them' if len(unlocked) > 1 else 'it'} in one of {sorted(WRITER_BLOCKING_MODES)}, so "
        "a row committed between the read and the act escapes the refusal"
    )


@pytest.mark.parametrize("migration", migrations_that_copy_then_change(), ids=lambda p: p.stem)
def test_a_migration_locks_what_it_copies_and_then_changes(migration: Path) -> None:
    """**A copy taken to replace what it was copied from must be the last word on it** (BE-A1,
    RE-2).

    A retype lifts a criterion's rows into a temp table, deletes them, and inserts the copy back;
    a replacement copies one attribute's criteria onto its successor and deletes the old ones. A
    set edit committed between the copy and the delete is deleted with the rest, and the copy
    taken before it stands in its place: the edit is lost, and its pillar's weights may no longer
    sum to 100. Every table copied from and then changed is locked first, in a mode that holds off
    writers -- an edit in flight lands first and is copied, and none lands after until the
    migration commits.

    Forward migrations are held to it as well as rollbacks: `make migrate` runs while the backend
    may be serving edits, exactly as `make rollback` does.
    """
    unlocked = unlocked_copies(migration.read_text())

    assert unlocked == set(), (
        f"{migration.name} copies rows of {sorted(unlocked)} and then changes "
        f"{'them' if len(unlocked) > 1 else 'it'} without first locking "
        f"{'them' if len(unlocked) > 1 else 'it'} in one of {sorted(WRITER_BLOCKING_MODES)}, so "
        "an edit committed after the copy is lost"
    )


LOCKED = "LOCK TABLE criterion IN SHARE ROW EXCLUSIVE MODE;\n"
LIFT_AND_RESTORE = (
    "CREATE TEMP TABLE kept AS SELECT * FROM criterion WHERE attribute = 'a';\n"
    "DELETE FROM criterion WHERE attribute = 'a';\n"
)


@pytest.mark.parametrize(
    ("sql", "unlocked"),
    [
        (LIFT_AND_RESTORE, {"criterion"}),
        (LOCKED + LIFT_AND_RESTORE, set()),
        (
            "INSERT INTO criterion (attribute) SELECT 'b' FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            {"criterion"},
        ),
        (
            "CREATE TEMP TABLE kept (attribute text);\n"
            "INSERT INTO kept SELECT attribute FROM criterion;\n"
            "UPDATE criterion SET weight = 0;\n",
            {"criterion"},
        ),
        (
            "CREATE TABLE kept AS SELECT * FROM /* the old rows */ criterion;\n"
            "DELETE FROM criterion;\n",
            {"criterion"},
        ),
        ("INSERT INTO unit (id) VALUES ('x');\n" + LOCKED + LIFT_AND_RESTORE, {"criterion"}),
        (
            "LOCK TABLE criterion IN ROW SHARE MODE;\n" + LIFT_AND_RESTORE,
            {"criterion"},
        ),
        ("LOCK TABLE ONLY criterion IN SHARE MODE NOWAIT;\n" + LIFT_AND_RESTORE, set()),
        ("LOCK criterion;\n" + LIFT_AND_RESTORE, set()),
        ("INSERT INTO criterion SELECT * FROM criterion WHERE criteria_set = 'a';\n", set()),
        ("-- copies FROM criterion, then DELETE FROM criterion\nSELECT 1;\n", set()),
        ("SELECT E'can\\'t';\n" + LIFT_AND_RESTORE, {"criterion"}),
    ],
    ids=[
        "a temp-table copy",
        "locked first",
        "insert-select",
        "a temp table filled later",
        "create table as, behind a comment",
        "locked, but not first",
        "a mode that admits writers",
        "only and nowait",
        "no mode: access exclusive",
        "a copy nothing then changes",
        "prose",
        "behind an escaped quote",
    ],
)
def test_the_copy_rule_reads_sql_as_a_migration_writes_it(sql: str, unlocked: set[str]) -> None:
    """The rule is only as good as its reading, so the reading is tested on the shapes a
    migration could plausibly take -- including the ones the first version missed (RE-2)."""
    assert unlocked_copies(sql) == unlocked


@pytest.mark.parametrize(
    ("sql", "unlocked"),
    [
        (
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM value) OR (SELECT count(1) FROM evaluation) > 0 "
            "THEN RAISE EXCEPTION 'restore from the backup'; END IF; END $$;\n",
            {"value", "evaluation"},
        ),
        (
            "LOCK TABLE value, evaluation IN SHARE ROW EXCLUSIVE MODE;\n"
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM value JOIN evaluation ON true) "
            "THEN RAISE EXCEPTION 'from the backup'; END IF; END $$;\n",
            set(),
        ),
        ("DO $$ BEGIN PERFORM 1 FROM value; END $$;\n", set()),
        (
            "SELECT $$'$$;\n"
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM value) "
            "THEN RAISE EXCEPTION 'from the backup'; END IF; END $$;\n",
            {"value"},
        ),
    ],
    ids=[
        "exists and count(1)",
        "locked first",
        "a block that never refuses",
        "behind a quote in dollar quotes",
    ],
)
def test_the_refusal_rule_reads_sql_as_a_migration_writes_it(sql: str, unlocked: set[str]) -> None:
    assert unlocked_refusal_reads(sql) == unlocked


#: A `DO $$` block's body, found as the refusal check above finds it.
DO_BLOCK = re.compile(r"\bdo\s+\$\$(.*?)\$\$", re.I | re.S)


def anywhere(code: str) -> str:
    return code


def outside_do_blocks(code: str) -> str:
    return DO_BLOCK.sub(" ", code)


def inside_do_blocks(code: str) -> str:
    return "\n".join(DO_BLOCK.findall(code))


@dataclass(frozen=True)
class Unreadable:
    """A shape of SQL the two lock checks above cannot read, and the form to write instead.

    `pattern` is searched only in what `searched_in` keeps of the code, so a shape can be
    refused in a plain statement and allowed in a `DO` block, or the other way round.
    """

    name: str
    pattern: str
    searched_in: Callable[[str], str]
    instead: str

    def is_in(self, code: str) -> bool:
        return re.search(self.pattern, self.searched_in(code), re.I) is not None


#: The fail-closed list: every shape of SQL known to slip past the two lock checks above.
UNREADABLE: tuple[Unreadable, ...] = (
    Unreadable(
        name="DO not followed by $$",
        # `DO NOTHING` and `DO UPDATE` end an upsert; they open no block.
        pattern=r"\bdo\b(?!\s+\$\$|\s+(?:nothing|update)\b)",
        searched_in=anywhere,
        instead="write `DO $$ ... $$`, with no tag and no LANGUAGE: plpgsql is the default",
    ),
    Unreadable(
        name="RAISE with no level or no message",
        # With no level a RAISE refuses, and the refusal check knows one only as RAISE EXCEPTION.
        pattern=r"\braise\b(?!\s+(?:debug|log|info|notice|warning|exception)\s+'')",
        searched_in=anywhere,
        instead="name the level, then give the message as text: `RAISE EXCEPTION '<message>'`",
    ),
    Unreadable(
        name="ASSERT",
        pattern=r"\bassert\b",
        searched_in=anywhere,
        instead="write `IF NOT (<condition>) THEN RAISE EXCEPTION '<message>'; END IF;`",
    ),
    Unreadable(
        name="a statement starting with WITH",
        pattern=r"(?:\A|;)\s*with\b",
        searched_in=anywhere,
        instead="lift the rows with `CREATE TEMP TABLE ... AS SELECT`, then copy them from it "
        "with `INSERT ... SELECT`",
    ),
    Unreadable(
        name="SELECT INTO outside a DO block",
        # Inside one, `SELECT ... INTO` fills a variable, not a table.
        pattern=r"(?:\A|;)\s*select\b[^;]*\binto\b",
        searched_in=outside_do_blocks,
        instead="write `CREATE TEMP TABLE ... AS SELECT`",
    ),
    Unreadable(
        name="CREATE UNLOGGED",
        pattern=r"\bcreate\s+unlogged\b",
        searched_in=anywhere,
        instead="write `CREATE TEMP TABLE ... AS SELECT`, or `CREATE TABLE`",
    ),
    Unreadable(
        name="a copy written without SELECT",
        # `TABLE t` is `SELECT * FROM t`, and the copy check knows a copy only by its SELECT.
        pattern=r"(?:(?:\A|;)\s*|\bas\s+|\binto\s+\"?\w+\"?(?:\s*\([^)]*\))?\s+)table\b",
        searched_in=anywhere,
        instead="write `SELECT * FROM <table>`",
    ),
    Unreadable(
        name="a function, procedure or trigger",
        # Its body is a string until it runs, so the checks read neither its refusal nor its copy.
        pattern=r"\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?"
        r"(?:function|procedure|trigger)\b",
        searched_in=anywhere,
        instead="check in a `DO $$ ... $$` block and write with statements of their own",
    ),
    Unreadable(
        name="a write, DDL or dynamic SQL inside a DO block",
        pattern=r"\b(?:insert|update|delete|merge|truncate|create|alter|drop|execute)\b",
        searched_in=inside_do_blocks,
        instead="write it as a statement of its own, outside the block and never through "
        "EXECUTE: a DO block only checks",
    ),
)


def unreadable_in(sql: str) -> list[Unreadable]:
    code = code_of(sql)
    return [shape for shape in UNREADABLE if shape.is_in(code)]


@pytest.mark.parametrize("script", sorted(MIGRATIONS.glob("*.sql")), ids=lambda p: p.stem)
def test_a_migration_holds_nothing_the_lock_checks_cannot_read(script: Path) -> None:
    """**What the lock checks cannot read, they refuse** (P98, RE-9).

    The two checks above are readers: they know a refusal by `DO $$ ... RAISE EXCEPTION ... $$`
    and a copy by a statement that starts `INSERT INTO` or `CREATE TABLE`, and they take
    anything else for no refusal and no copy at all. A refusal in a `DO $r$` block, or a copy
    that starts with `WITH`, would pass them unlocked -- the very failure they exist to stop.
    Teaching them each shape would leave the next one open, so every shape known to slip past
    them is refused here instead, in a forward migration or a rollback alike, and the message
    names the form they do read.
    """
    unreadable = unreadable_in(script.read_text())

    assert unreadable == [], (
        f"{script.name} is written in a shape the lock checks above cannot read, so a refusal "
        "or a copy written that way would pass them unlocked. "
        + " ".join(f"For {shape.name}, {shape.instead}." for shape in unreadable)
    )


RAISES = "RAISE EXCEPTION 'restore from the backup'"


def refusal(raising: str, opened: str = "DO $$", closed: str = "$$") -> str:
    """A refusal as the shipped rollbacks write one, opened, raised and closed as given."""
    return f"{opened} BEGIN IF EXISTS (SELECT 1 FROM value) THEN {raising}; END IF; END {closed};\n"


#: A copy the copy check cannot read, so the fail-closed list refuses it wherever it stands.
WITH_COPY = (
    "WITH kept AS (SELECT * FROM criterion WHERE attribute = 'a')\n"
    "INSERT INTO criterion (attribute) SELECT 'b' FROM kept;\n"
    "DELETE FROM criterion WHERE attribute = 'a';\n"
)


@pytest.mark.parametrize(
    ("sql", "refused_as"),
    [
        pytest.param(
            refusal(RAISES, opened="DO $r$", closed="$r$"), ["DO not followed by $$"], id="DO $tag$"
        ),
        pytest.param(
            refusal(RAISES, opened="DO LANGUAGE plpgsql $$"),
            ["DO not followed by $$"],
            id="DO LANGUAGE",
        ),
        pytest.param(refusal(RAISES), [], id="DO $$"),
        pytest.param(
            "INSERT INTO unit (id) VALUES ('x') ON CONFLICT DO NOTHING;\n"
            "INSERT INTO unit (id) VALUES ('x') ON CONFLICT (id) DO UPDATE SET id = excluded.id;\n",
            [],
            id="an upsert's DO",
        ),
        pytest.param(
            refusal("RAISE 'restore from the backup'"),
            ["RAISE with no level or no message"],
            id="RAISE 'message'",
        ),
        pytest.param(
            refusal("RAISE USING MESSAGE = 'restore from the backup'"),
            ["RAISE with no level or no message"],
            id="RAISE USING",
        ),
        pytest.param(
            refusal("RAISE SQLSTATE 'P0001'"),
            ["RAISE with no level or no message"],
            id="RAISE SQLSTATE",
        ),
        pytest.param(
            refusal("RAISE EXCEPTION USING MESSAGE = 'restore from the backup'"),
            ["RAISE with no level or no message"],
            id="RAISE EXCEPTION USING",
        ),
        pytest.param(refusal(RAISES + " USING ERRCODE = 'P0001'"), [], id="RAISE EXCEPTION '...'"),
        pytest.param(refusal("RAISE NOTICE 'nothing to restore'"), [], id="RAISE NOTICE"),
        pytest.param(refusal("RAISE NOTICE E'nothing to restore'"), [], id="RAISE NOTICE E'...'"),
        pytest.param(
            "DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM value), 'restore from the backup'; "
            "END $$;\n",
            ["ASSERT"],
            id="ASSERT",
        ),
        pytest.param("SELECT $$ASSERT$$;\n", [], id="ASSERT inside $$...$$"),
        pytest.param("SELECT E'can\\'t ASSERT';\n", [], id="ASSERT inside E'...'"),
        pytest.param(WITH_COPY, ["a statement starting with WITH"], id="a copy starting with WITH"),
        pytest.param(
            "CREATE TEMP TABLE kept AS SELECT * FROM criterion WHERE attribute = 'a';\n"
            "INSERT INTO criterion (attribute) SELECT 'b' FROM kept;\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            [],
            id="a temp table, then INSERT ... SELECT",
        ),
        pytest.param(
            "SELECT * INTO TEMP kept FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            ["SELECT INTO outside a DO block"],
            id="SELECT INTO TEMP",
        ),
        pytest.param(LIFT_AND_RESTORE, [], id="CREATE TEMP TABLE AS"),
        pytest.param(
            "DO $$ DECLARE stored integer; frozen integer; BEGIN\n"
            "SELECT count(*) INTO stored FROM value;\n"
            "SELECT count(*) INTO frozen FROM evaluation;\n"
            "IF stored + frozen > 0 THEN RAISE EXCEPTION 'restore from the backup'; END IF;\n"
            "END $$;\n",
            [],
            id="SELECT INTO a variable in DO $$",
        ),
        pytest.param(
            "CREATE UNLOGGED TABLE kept AS SELECT * FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            ["CREATE UNLOGGED"],
            id="CREATE UNLOGGED TABLE AS",
        ),
        pytest.param(
            "CREATE TABLE kept AS SELECT * FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            [],
            id="CREATE TABLE AS",
        ),
        pytest.param(
            "DO $$ BEGIN INSERT INTO kept SELECT * FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a'; END $$;\n",
            ["a write, DDL or dynamic SQL inside a DO block"],
            id="a copy inside DO",
        ),
        pytest.param(
            "INSERT INTO kept SELECT * FROM criterion WHERE attribute = 'a';\n"
            "DELETE FROM criterion WHERE attribute = 'a';\n",
            [],
            id="the copy as statements of its own",
        ),
        pytest.param(
            "DO $$ BEGIN EXECUTE 'DELETE FROM criterion'; END $$;\n",
            ["a write, DDL or dynamic SQL inside a DO block"],
            id="EXECUTE inside DO",
        ),
        pytest.param(
            "DO $$ BEGIN ALTER TABLE criterion ADD COLUMN note text; END $$;\n",
            ["a write, DDL or dynamic SQL inside a DO block"],
            id="ALTER inside DO",
        ),
        pytest.param(
            "DO $$ BEGIN DROP TABLE kept; END $$;\n",
            ["a write, DDL or dynamic SQL inside a DO block"],
            id="DROP inside DO",
        ),
        pytest.param(
            "ALTER TABLE criterion ADD COLUMN note text;\nDROP TABLE kept;\n",
            [],
            id="DDL as statements of its own",
        ),
        pytest.param(
            "CREATE TEMP TABLE kept AS TABLE criterion;\nDELETE FROM criterion;\n",
            ["a copy written without SELECT"],
            id="CREATE TABLE AS TABLE",
        ),
        pytest.param(
            "INSERT INTO kept (attribute) TABLE criterion;\nDELETE FROM criterion;\n",
            ["a copy written without SELECT"],
            id="INSERT INTO ... TABLE",
        ),
        pytest.param(
            "TABLE criterion;\nLOCK TABLE criterion;\nCOMMENT ON TABLE criterion IS 'x';\n"
            "TRUNCATE TABLE kept;\n",
            ["a copy written without SELECT"],
            id="a TABLE statement among TABLE keywords",
        ),
        pytest.param(
            "CREATE FUNCTION refuse() RETURNS void AS $f$ BEGIN "
            "IF EXISTS (SELECT 1 FROM value) THEN RAISE EXCEPTION 'from the backup'; END IF; "
            "END $f$ LANGUAGE plpgsql;\nSELECT refuse();\n",
            ["a function, procedure or trigger"],
            id="a refusal in a function",
        ),
        pytest.param(
            "CREATE OR REPLACE PROCEDURE copy() AS $$ DELETE FROM criterion $$ LANGUAGE sql;\n"
            "CALL copy();\n",
            ["a function, procedure or trigger"],
            id="a procedure",
        ),
        pytest.param(
            "CREATE TRIGGER t AFTER DELETE ON criterion FOR EACH ROW EXECUTE FUNCTION f();\n",
            ["a function, procedure or trigger"],
            id="a trigger",
        ),
    ],
)
def test_the_fail_closed_rule_reads_sql_as_a_migration_writes_it(
    sql: str, refused_as: list[str]
) -> None:
    """Each shape is refused, and the form its message names instead is not -- nor is what only
    looks like one: an upsert's `DO`, `RAISE NOTICE`, a `SELECT ... INTO` a variable, or a
    keyword inside a literal."""
    assert [shape.name for shape in unreadable_in(sql)] == refused_as


@pytest.mark.parametrize(
    "literal",
    [
        pytest.param("$$'$$", id="a quote in $$...$$"),
        pytest.param("$q$'$q$", id="a quote in $tag$...$tag$"),
        pytest.param("E'can\\'t'", id="a backslashed quote in E'...'"),
        pytest.param("E'can'\n'\\'t'", id="a backslashed quote where E'...' carries on"),
        pytest.param('1 AS "it\'s"', id="a quote in a quoted name"),
        pytest.param("'C:\\'", id="a backslash ending a plain string"),
        pytest.param("CASE WHEN true THEN 'yes' ELSE'C:\\' END", id="ELSE'...', no E'...'"),
        pytest.param("1 AS price$$", id="$$ ending a name"),
    ],
)
def test_no_literal_hides_the_statement_after_it(literal: str) -> None:
    """**A literal ends where PostgreSQL ends it** (P98). Read to any other end, it turns the
    statements after it into the inside of a string, and all three checks pass them unread --
    here, a copy that starts with `WITH`."""
    refused = [shape.name for shape in unreadable_in(f"SELECT {literal};\n" + WITH_COPY)]

    assert refused == ["a statement starting with WITH"]
