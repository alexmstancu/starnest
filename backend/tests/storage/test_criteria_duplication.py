"""Duplicating a criteria set copies all of it, proven child table by child table.

`reqs.md` Q191: a criteria set is a **full copy**, never a sparse overlay on another set. That
is what lets `alex` and `partner` diverge without either one changing when the other is edited.

**Through the path the product takes** (map-C03 S3). `duplicateCriteriaSet` reads the set
through the store, copies it with `CriteriaSet.duplicated_as` and writes the copy with
`create_criteria_set` (`api/criteria.py`), so what a copy contains is decided in one place -- the
domain. These tests used to prove a SQL statement of their own, which nothing in the product ran.

**A dropped column here fails silently and looks fine.** The copy has the right number of
criteria, the right weights and the right thresholds; only a word beside a number is missing,
and a band with no label reads as a band nobody named rather than as a copy that lost it. So
this asserts the contents of the children, not their count.
"""

import contextlib
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import UnknownCriteriaSetError
from starnest.storage import PostgresCriteriaStore

pytestmark = pytest.mark.storage

THE_SEEDED_SET = "local_employment"
A_LABELLED_SOURCE = "a_labelled_source"
A_COPY = "a_copy_of_the_seeded_set"
LABELLED = "country.life_satisfaction"
A_BAND = (Decimal(8), 100, "content")


@pytest.fixture
async def criteria(pool: AsyncConnectionPool) -> AsyncIterator[PostgresCriteriaStore]:
    store = PostgresCriteriaStore(pool)
    yield store
    for made in (A_COPY, A_LABELLED_SOURCE):
        with contextlib.suppress(UnknownCriteriaSetError):
            await store.purge_criteria_set(made)


async def _duplicate(criteria: PostgresCriteriaStore, source: str) -> None:
    """What `duplicateCriteriaSet` does, without the HTTP around it."""
    original = await criteria.read_criteria_set(source)
    await criteria.create_criteria_set(original.duplicated_as(A_COPY, "A copy"))


async def _a_labelled_source(criteria: PostgresCriteriaStore, pool: AsyncConnectionPool) -> None:
    """A copy of the seeded set whose `life_satisfaction` band at 8 carries a label.

    The seeded set is catalog, read-only to a test (`arch.md` 1.2), and the store commits, so the
    label goes on a set the test owns.
    """
    seeded = await criteria.read_criteria_set(THE_SEEDED_SET)
    await criteria.create_criteria_set(seeded.duplicated_as(A_LABELLED_SOURCE, "Labelled"))
    input_value, _score, label = A_BAND
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE criterion_scale_anchor SET label = %s WHERE input_value = %s AND criterion ="
            " (SELECT id FROM criterion WHERE criteria_set = %s AND attribute = %s)",
            (label, input_value, A_LABELLED_SOURCE, LABELLED),
        )


async def _anchors_of(
    pool: AsyncConnectionPool, criteria_set: str, attribute: str
) -> list[tuple[Any, ...]]:
    """One criterion's anchors, named by set and attribute -- the pair a copy preserves."""
    async with pool.connection() as connection:
        rows = await (
            await connection.execute(
                """
                SELECT anchor.input_value, anchor.score, anchor.label
                FROM   criterion_scale_anchor AS anchor
                JOIN   criterion AS c ON c.id = anchor.criterion
                WHERE  c.criteria_set = %s AND c.attribute = %s
                ORDER  BY anchor.input_value
                """,
                (criteria_set, attribute),
            )
        ).fetchall()
    return [tuple(row) for row in rows]


async def test_a_duplicated_set_keeps_the_word_beside_the_number(
    criteria: PostgresCriteriaStore, pool: AsyncConnectionPool
) -> None:
    """A band label is part of the interpretation, so it is part of the copy (`reqs.md` 5.1).

    Losing it is the failure worth naming: the copied scale still scores every figure exactly
    as the original does, and only the reading of it goes missing -- which is a difference
    nobody would notice until the drill-down showed a number with nothing beside it.
    """
    await _a_labelled_source(criteria, pool)

    await _duplicate(criteria, A_LABELLED_SOURCE)

    copied = await _anchors_of(pool, A_COPY, LABELLED)
    assert A_BAND in copied
    assert copied == await _anchors_of(pool, A_LABELLED_SOURCE, LABELLED)


async def test_a_duplicated_set_carries_every_criterion_of_its_source(
    criteria: PostgresCriteriaStore, pool: AsyncConnectionPool
) -> None:
    """A copy with fewer criteria than its source is a copy that scores differently."""
    await _duplicate(criteria, THE_SEEDED_SET)

    async with pool.connection() as connection:
        counted = await (
            await connection.execute(
                "SELECT criteria_set, count(*) FROM criterion WHERE criteria_set IN (%s, %s)"
                " GROUP BY criteria_set",
                (THE_SEEDED_SET, A_COPY),
            )
        ).fetchall()
    counts = dict(tuple(row) for row in counted)
    assert counts[A_COPY] == counts[THE_SEEDED_SET] > 0


async def test_the_copy_and_its_source_hold_separate_anchors(
    criteria: PostgresCriteriaStore, pool: AsyncConnectionPool
) -> None:
    """A full copy, not an overlay: editing one set may not reach the other (`reqs.md` Q191)."""
    await _a_labelled_source(criteria, pool)
    await _duplicate(criteria, A_LABELLED_SOURCE)

    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE criterion_scale_anchor SET label = %s"
            " WHERE criterion IN (SELECT id FROM criterion WHERE criteria_set = %s)",
            ("renamed", A_COPY),
        )

    assert A_BAND in await _anchors_of(pool, A_LABELLED_SOURCE, LABELLED)
