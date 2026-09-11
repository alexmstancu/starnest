"""Duplicating a criteria set copies all of it, proven child table by child table.

`reqs.md` Q191: a criteria set is a **full copy**, never a sparse overlay on another set. That
is what lets `alex` and `partner` diverge without either one changing when the other is edited,
and it makes `duplicate_criteria_set` the one statement in the system whose correctness is
measured by what it does *not* leave behind.

**A dropped column here fails silently and looks fine.** The copy has the right number of
criteria, the right weights and the right thresholds; only a word beside a number is missing,
and a band with no label reads as a band nobody named rather than as a copy that lost it. So
this asserts the contents of the children, not their count.

The query is loaded through `aiosql` exactly as the application loads it, but against the
synchronous connection, whose work is rolled back -- the seeded catalog is read-only through
the store seam (`arch.md` 1.2) and a duplicate is a catalog row like any other.
"""

from decimal import Decimal
from pathlib import Path

import aiosql
import psycopg
import pytest

pytestmark = pytest.mark.storage

QUERIES = aiosql.from_path(Path(__file__).resolve().parents[3] / "storage" / "queries", "psycopg")

THE_SEEDED_SET = "local_employment"
A_COPY = "a_copy_of_the_seeded_set"
A_BAND = (Decimal("500"), 100, "affordable")


def _a_criterion_of_the_seeded_set(connection: psycopg.Connection) -> tuple[int, str]:
    """Any one that carries no anchors yet, with its attribute. Which one is not under test.

    **Without anchors of its own** since `0447` shipped the first real ones, on the total tax
    rate: the assertions below compare one criterion's anchors, and anchoring a criterion that
    already had some would compare the test's band against the household's.
    """
    return connection.execute(
        """
        SELECT c.id, c.attribute FROM criterion AS c
        WHERE  c.criteria_set = %s
          AND  NOT EXISTS (SELECT 1 FROM criterion_scale_anchor a WHERE a.criterion = c.id)
        ORDER  BY c.id LIMIT 1
        """,
        (THE_SEEDED_SET,),
    ).fetchone()


def _anchor(connection: psycopg.Connection, criterion: int) -> None:
    input_value, score, label = A_BAND
    connection.execute(
        "INSERT INTO criterion_scale_anchor (criterion, input_value, score, label)"
        " VALUES (%s, %s, %s, %s)",
        (criterion, input_value, score, label),
    )


def _anchors_of(connection: psycopg.Connection, criteria_set: str, attribute: str) -> list[tuple]:
    """One criterion's anchors, named by set and attribute -- the pair a copy preserves.

    Scoped to one criterion rather than the whole set: the set as a whole now carries the
    household's tax anchors too, and these tests are about the one band they wrote.
    """
    return connection.execute(
        """
        SELECT anchor.input_value, anchor.score, anchor.label
        FROM   criterion_scale_anchor AS anchor
        JOIN   criterion AS c ON c.id = anchor.criterion
        WHERE  c.criteria_set = %s AND c.attribute = %s
        ORDER  BY anchor.input_value
        """,
        (criteria_set, attribute),
    ).fetchall()


def _duplicate(connection: psycopg.Connection) -> int:
    return QUERIES.duplicate_criteria_set(
        connection, criteria_set=THE_SEEDED_SET, new_criteria_set=A_COPY, name="A copy"
    )


def test_a_duplicated_set_keeps_the_word_beside_the_number(
    connection: psycopg.Connection,
) -> None:
    """A band label is part of the interpretation, so it is part of the copy (`reqs.md` 5.1).

    Losing it is the failure worth naming: the copied scale still scores every figure exactly
    as the original does, and only the reading of it goes missing -- which is a difference
    nobody would notice until the drill-down showed a number with nothing beside it.
    """
    criterion, attribute = _a_criterion_of_the_seeded_set(connection)
    _anchor(connection, criterion)

    _duplicate(connection)

    assert _anchors_of(connection, A_COPY, attribute) == [A_BAND]


def test_a_duplicated_set_carries_every_criterion_of_its_source(
    connection: psycopg.Connection,
) -> None:
    """The count the statement returns is the count that was copied.

    A copy with fewer criteria than its source is a copy that scores differently, so the number
    is worth reading rather than discarding.
    """
    of_the_source = connection.execute(
        "SELECT count(*) FROM criterion WHERE criteria_set = %s", (THE_SEEDED_SET,)
    ).fetchone()[0]

    copied = _duplicate(connection)

    assert copied == of_the_source
    assert (
        connection.execute(
            "SELECT count(*) FROM criterion WHERE criteria_set = %s", (A_COPY,)
        ).fetchone()[0]
        == of_the_source
    )


def test_the_copy_and_its_source_hold_separate_anchors(
    connection: psycopg.Connection,
) -> None:
    """A full copy, not an overlay: editing one set may not reach the other (`reqs.md` Q191)."""
    criterion, attribute = _a_criterion_of_the_seeded_set(connection)
    _anchor(connection, criterion)
    _duplicate(connection)

    connection.execute(
        "UPDATE criterion_scale_anchor SET label = %s"
        " WHERE criterion IN (SELECT id FROM criterion WHERE criteria_set = %s)",
        ("renamed", A_COPY),
    )

    assert _anchors_of(connection, THE_SEEDED_SET, attribute) == [A_BAND]
