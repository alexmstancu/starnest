"""What the seed of researchable gates refuses before it changes anything (`0502`, NEW-01).

`0502` marks the three gates research can answer and names the one country each concerns. **It
names rows it did not create** -- three gates and three countries seeded by earlier migrations --
so it checks they exist first and refuses, naming what is missing, rather than marking two gates
of three and leaving the third to be asked about every country again.

**Run against a database that lacks what it names**, inside one transaction that is always rolled
back: the seed's own statements, each in its own savepoint, so a refusal leaves standing whatever
ran before it. That is how "before changing anything" is asserted rather than read off the file.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from yoyo.migrations import read_sql_migration

pytestmark = pytest.mark.storage

MIGRATIONS = Path(__file__).resolve().parents[2].parent / "storage" / "migrations"
THE_SEED = MIGRATIONS / "0502-research-asks-only-the-gates-it-can-answer.sql"
ITS_ROLLBACK = THE_SEED.with_name(f"{THE_SEED.stem}.rollback.sql")

WHAT_IT_SEEDS = [
    ("ch_eu_efta_quota", "country.switzerland"),
    ("li_eea_quota", "country.liechtenstein"),
    ("uk_skilled_worker", "country.united_kingdom"),
]


def _statements(migration: Path) -> list[str]:
    """The statements `yoyo` would run, split by `yoyo`'s own parser."""
    assert migration.exists(), f"{migration.name} does not exist"
    _directives, _leading_comment, statements = read_sql_migration(str(migration))
    return statements


def _apply_until_refused(
    connection: psycopg.Connection, statements: list[str]
) -> psycopg.Error | None:
    """Each statement in its own savepoint. The first refusal is returned and the rest are not
    run, so what the earlier statements did is still there to be looked at."""
    for statement in statements:
        try:
            with connection.transaction():
                connection.execute(statement)
        except psycopg.Error as refusal:
            return refusal
    return None


@pytest.fixture
def before_the_seed(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """The database as the migration before it left it, inside a transaction always rolled back.

    **The outer transaction is explicit, and it has to be.** A savepoint needs a transaction to
    sit in, and psycopg's `transaction()` on an idle connection begins one and *commits* it -- so
    the seed's rollback, run that way, would undo the seed for every test after this one.
    """
    with connection.transaction(force_rollback=True):
        assert _apply_until_refused(connection, _statements(ITS_ROLLBACK)) is None
        assert not _the_seed_changed_anything(connection)
        yield connection


def _without_the_gate(connection: psycopg.Connection, gate: str) -> None:
    """A catalog that never declared `gate`: everything that refers to it goes first."""
    for referring in (
        "DELETE FROM criteria_set_match_rule WHERE match_rule = %s",
        "DELETE FROM non_match_reason WHERE match_rule = %s",
        "DELETE FROM match_rule_result_citation WHERE match_rule = %s",
        "DELETE FROM match_rule_result WHERE match_rule = %s",
        "DELETE FROM match_rule_answer_citation WHERE answer IN "
        "(SELECT id FROM match_rule_answer WHERE match_rule = %s)",
        "DELETE FROM match_rule_answer WHERE match_rule = %s",
        "DELETE FROM match_rule_research_spend WHERE match_rule = %s",
        "DELETE FROM match_rule_clearing_citizenship WHERE match_rule = %s",
        "DELETE FROM match_rule WHERE id = %s",
    ):
        connection.execute(referring, (gate,))


def _the_seed_changed_anything(connection: psycopg.Connection) -> bool:
    """Whether either thing the seed adds -- the column, or the table of concerned candidates --
    is in the schema."""
    column = connection.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'match_rule' AND column_name = 'researchable'"
    ).fetchone()
    (table,) = connection.execute("SELECT to_regclass('match_rule_candidate')").fetchone()
    return column is not None or table is not None


def test_the_seed_applies_to_a_catalog_holding_everything_it_names(
    before_the_seed: psycopg.Connection,
) -> None:
    """The control: with every gate and country present nothing is refused, so a refusal below
    is the guard speaking rather than this harness failing to run the file."""
    connection = before_the_seed

    assert _apply_until_refused(connection, _statements(THE_SEED)) is None
    assert (
        connection.execute(
            "SELECT match_rule, candidate FROM match_rule_candidate ORDER BY match_rule"
        ).fetchall()
        == WHAT_IT_SEEDS
    )
    assert connection.execute(
        "SELECT id FROM match_rule WHERE researchable ORDER BY id"
    ).fetchall() == [(gate,) for gate, _ in WHAT_IT_SEEDS]


def test_a_gate_it_names_that_is_missing_is_refused_before_anything_changes(
    before_the_seed: psycopg.Connection,
) -> None:
    connection = before_the_seed
    _without_the_gate(connection, "li_eea_quota")

    refusal = _apply_until_refused(connection, _statements(THE_SEED))

    assert isinstance(refusal, errors.RaiseException), f"not refused by the guard: {refusal!r}"
    assert "li_eea_quota" in str(refusal)
    assert not _the_seed_changed_anything(connection)


def test_a_candidate_it_names_that_is_missing_is_refused_before_anything_changes(
    before_the_seed: psycopg.Connection,
) -> None:
    """A country is referred to from too many tables to remove one inside a test, so the seed is
    pointed at a country the catalog never had -- the same mismatch, seen from the other side."""
    connection = before_the_seed
    statements = [
        statement.replace("'country.liechtenstein'", "'country.atlantis'")
        for statement in _statements(THE_SEED)
    ]
    assert any("'country.atlantis'" in statement for statement in statements), (
        "the seed no longer names Liechtenstein the way this test replaces it"
    )

    refusal = _apply_until_refused(connection, statements)

    assert isinstance(refusal, errors.RaiseException), f"not refused by the guard: {refusal!r}"
    assert "country.atlantis" in str(refusal)
    assert not _the_seed_changed_anything(connection)
