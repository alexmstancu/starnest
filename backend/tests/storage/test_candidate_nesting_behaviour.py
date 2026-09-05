"""A candidate at a nested level belongs to something.

Three constraints already guarded the hierarchy and all three keyed on `parent_level`, which is
nullable -- so a NULL skipped every one of them and a city belonging to no country inserted
cleanly (known-issues D11). Migration `0114` closes it.

**Why `MATCH FULL` is not the fix**, though it is the obvious guess and the one the finding
suggested: `candidate.level` is `NOT NULL`, so the pair `(level, parent_level)` is never
entirely null, and `MATCH FULL` would therefore reject every **country** -- whose `parent_level`
is legitimately absent. The rule is not "both or neither" but "a parent is required exactly when
this candidate's level declares one", and that is a fact in another table. `0114` brings it to
where a `CHECK` can read it.

**Nothing here decides which levels exist.** The tests read the shallowest and the nested level
out of the `level` table rather than naming `country` and `city`, because no code may assume
there are exactly two (`reqs.md` 3.1) -- including test code, which is where such an assumption
would go unnoticed longest.
"""

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.storage


def _shallowest_and_nested(connection: psycopg.Connection) -> tuple[str, str]:
    """The first two levels in depth order, whatever they are called."""
    rows = connection.execute("SELECT id FROM level ORDER BY depth_order LIMIT 2").fetchall()
    assert len(rows) == 2, "these tests need a level that nests under another"
    return rows[0][0], rows[1][0]


def _a_candidate_at(connection: psycopg.Connection, level: str) -> str:
    row = connection.execute(
        "SELECT id FROM candidate WHERE level = %s LIMIT 1", (level,)
    ).fetchone()
    assert row is not None
    return row[0]


def _record(
    connection: psycopg.Connection,
    *,
    identifier: str,
    level: str,
    parent_level: str | None,
    parent: str | None,
    parent_required: bool | None = None,
) -> None:
    """A candidate, taking `parent_required` from its level unless a test insists otherwise."""
    connection.execute(
        """
        INSERT INTO candidate (id, name, level, parent_level, parent_candidate, parent_required)
        SELECT %s, %s, l.id, %s, %s, COALESCE(%s, l.requires_parent)
        FROM   level AS l
        WHERE  l.id = %s
        """,
        (identifier, identifier, parent_level, parent, parent_required, level),
    )


class TestANestedCandidateNamesItsParent:
    def test_a_candidate_at_a_nested_level_with_a_parent_is_stored(
        self, connection: psycopg.Connection
    ) -> None:
        """The control."""
        shallowest, nested = _shallowest_and_nested(connection)
        parent = _a_candidate_at(connection, shallowest)

        _record(
            connection,
            identifier=f"{nested}.with_a_parent",
            level=nested,
            parent_level=shallowest,
            parent=parent,
        )

        stored = connection.execute(
            "SELECT parent_candidate FROM candidate WHERE id = %s",
            (f"{nested}.with_a_parent",),
        ).fetchone()
        assert stored == (parent,)

    def test_a_candidate_at_a_nested_level_with_no_parent_is_refused(
        self, connection: psycopg.Connection
    ) -> None:
        """The defect. Both parent columns null satisfied every constraint there used to be."""
        _, nested = _shallowest_and_nested(connection)

        with pytest.raises(errors.CheckViolation):
            _record(
                connection,
                identifier=f"{nested}.orphan",
                level=nested,
                parent_level=None,
                parent=None,
            )

    def test_a_candidate_at_the_shallowest_level_needs_no_parent(
        self, connection: psycopg.Connection
    ) -> None:
        """The other control, and the reason `MATCH FULL` would have been the wrong fix.

        A country's `parent_level` is legitimately absent. Any rule that rejects a null pair
        outright rejects every candidate at the top of the hierarchy.
        """
        shallowest, _ = _shallowest_and_nested(connection)

        _record(
            connection,
            identifier=f"{shallowest}.needs_no_parent",
            level=shallowest,
            parent_level=None,
            parent=None,
        )

        stored = connection.execute(
            "SELECT parent_required FROM candidate WHERE id = %s",
            (f"{shallowest}.needs_no_parent",),
        ).fetchone()
        assert stored == (False,)

    def test_a_candidate_cannot_claim_its_level_needs_no_parent(
        self, connection: psycopg.Connection
    ) -> None:
        """What makes the copied flag trustworthy rather than merely present.

        Without the key pinning it to the level, the check above is satisfied by writing
        `false` beside a missing parent, which would enforce nothing at all.
        """
        _, nested = _shallowest_and_nested(connection)

        with pytest.raises(errors.ForeignKeyViolation):
            _record(
                connection,
                identifier=f"{nested}.lying_about_its_level",
                level=nested,
                parent_level=None,
                parent=None,
                parent_required=False,
            )
