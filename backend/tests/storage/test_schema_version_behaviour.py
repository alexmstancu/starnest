"""Whether the application would start against this database (`arch.md` 9.2 step 2).

**Refusing to start is the point.** An application running against a schema missing the column
it was written for does not fail at boot; it fails later, on the first write that needs the
column, as a value nobody can explain. And because `make migrate` is deliberately never
automatic (`arch.md` 7.4), the refusal is what connects the two -- it names the gap and the
command.

Against the real database, because the question is about a real database: a fake would answer
whatever it was told.
"""

from pathlib import Path

import pytest

from starnest.storage import SchemaBehindError, refuse_if_behind, schema_state

pytestmark = pytest.mark.storage


def test_the_workstreams_database_is_current(database_url: str) -> None:
    """The suite's own database is migrated by `tests/conftest.py`, so this both checks the
    check and states the precondition every other storage test rests on."""
    state = schema_state(database_url)

    assert state.unapplied == ()
    assert state.is_behind is False
    assert len(state.applied) > 50


def test_a_database_missing_a_migration_is_refused(database_url: str, tmp_path: Path) -> None:
    """A migration this database has never seen, in a directory of its own.

    Written rather than imagined: the gap is a real file yoyo reads, so the check is exercised
    the way it will be when somebody adds a migration and forgets to apply it.
    """
    unapplied = tmp_path / "0999-a-migration-nobody-applied.sql"
    unapplied.write_text("-- depends:\n\nSELECT 1;\n")

    with pytest.raises(SchemaBehindError) as refusal:
        refuse_if_behind(database_url, migrations=tmp_path)

    assert "0999-a-migration-nobody-applied" in str(refusal.value)
    assert "make migrate" in str(refusal.value)


def test_a_current_database_is_not_refused(database_url: str, tmp_path: Path) -> None:
    """The control: the same call over a directory with nothing to apply returns rather than
    raising, so the refusal above is attributable to the missing migration."""
    state = refuse_if_behind(database_url, migrations=tmp_path)

    assert state.unapplied == ()


def test_the_refusal_names_every_gap_not_only_the_first(database_url: str, tmp_path: Path) -> None:
    """Two restarts to find two faults is one restart too many."""
    (tmp_path / "0998-first-gap.sql").write_text("-- depends:\n\nSELECT 1;\n")
    (tmp_path / "0999-second-gap.sql").write_text("-- depends: 0998-first-gap\n\nSELECT 1;\n")

    with pytest.raises(SchemaBehindError) as refusal:
        refuse_if_behind(database_url, migrations=tmp_path)

    assert "0998-first-gap" in str(refusal.value)
    assert "0999-second-gap" in str(refusal.value)
