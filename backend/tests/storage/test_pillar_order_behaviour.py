"""What the pillar table refuses, and what it promises about order (`0484`).

**Nothing tested `display_order` at all.** It shipped with a `NOT NULL` and a `UNIQUE`, and the
word appeared in zero test files -- so nothing proved the constraints refuse what they name,
nothing proved `select_pillars` returns catalog order, and nothing proved the criteria listing
follows it. The order a reader sees is a decision somebody made; it is data, and data that
nothing checks is data that drifts.

**Nothing here reads `pg_constraint`.** A test that finds a constraint by name agrees with
whoever typed the name. Every check below writes a row and reports what the database said.
"""

import psycopg
import pytest

pytestmark = pytest.mark.storage


def test_the_pillars_come_back_in_their_stated_order(connection: psycopg.Connection) -> None:
    """The query the catalog store reads, asked the question the screens ask it."""
    rows = connection.execute(
        "SELECT id, display_order FROM pillar ORDER BY display_order"
    ).fetchall()

    assert [slot for _, slot in rows] == sorted(slot for _, slot in rows)
    assert [slot for _, slot in rows] == list(range(1, len(rows) + 1)), (
        "the order has a gap or does not start at 1"
    )


def test_economy_comes_first_rather_than_career(connection: psycopg.Connection) -> None:
    """**The reason the column exists.** Ordering by pillar id sorts alphabetically, which put
    career before economics on every screen -- an order nobody chose and no screen could
    explain."""
    first = connection.execute("SELECT id FROM pillar ORDER BY display_order LIMIT 1").fetchone()

    assert first is not None
    assert first[0] == "economics"


def test_two_pillars_cannot_claim_the_same_slot(connection: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(
            "UPDATE pillar SET display_order ="
            " (SELECT min(display_order) FROM pillar) WHERE id = 'family'"
        )


def test_a_pillar_cannot_have_no_slot_at_all(connection: psycopg.Connection) -> None:
    """A null would sort last or first depending on the query, which is the ambiguity the
    column was added to remove."""
    with pytest.raises(psycopg.errors.NotNullViolation):
        connection.execute("UPDATE pillar SET display_order = NULL WHERE id = 'family'")


def test_a_new_pillar_must_say_where_it_goes(connection: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.NotNullViolation):
        connection.execute("INSERT INTO pillar (id, name) VALUES ('leisure', 'Leisure')")


def test_every_pillar_reads_as_one_word(connection: psycopg.Connection) -> None:
    """The names the design asks for. A two-word name wraps in the weight rows, which is what
    `0484` renamed them to avoid -- and a migration that renamed ten of eleven would look
    exactly like one that renamed all of them."""
    names = [name for (name,) in connection.execute("SELECT name FROM pillar").fetchall()]

    assert names
    assert all(" " not in name for name in names), f"these wrap: {names}"
