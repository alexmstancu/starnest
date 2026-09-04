"""What the criteria tables refuse, proven by asking them to accept it.

`reqs.md` 3.3 draws the line these tests defend: an attribute with no criterion attached is
**descriptive** and never scored. Nothing said the same thing from the other side, so a
criterion could be attached to a pillar-less attribute and stored without complaint. The
consequence arrived somewhere else entirely -- `evaluation_criterion.pillar` is `NOT NULL`, so
the refusal came at SAVE time, after a ranking had been computed and shown to someone.
Migration 0106 moves the refusal to the write that causes it.

**Nothing here reads `pg_constraint`.** A test that finds a constraint by name agrees with
whoever typed the name; this suite has made that mistake once already (`test_schema_contract.py`,
`reqs.md` Q197). Every check below writes a row and reports what the database said about it.

**Every row these tests touch is their own**, including the criteria set. Written against the
seeded catalog instead, the first draft of this file passed with the foreign key deleted: it
named a criteria set that does not exist, so every insert failed on *that* key and three tests
read the refusal as their own. The control below exists so the same mistake cannot go unnoticed
a second time -- it asserts the insert succeeds when only the pillar is right, which is what
makes the refusals attributable to the pillar and nothing else.

The `connection` fixture rolls back, so none of it outlives the test.
"""

from decimal import Decimal

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.storage

A_SET = "criteria_constraint_behaviour"

A_DESCRIPTIVE_ATTRIBUTE = "country.subdivision_count"
"""An attribute in no pillar: a fact worth displaying about a place that answers no question
anyone weighted (`reqs.md` 3.3)."""

A_SCORED_ATTRIBUTE = "country.motorway_length"
"""An attribute in a pillar, and so eligible to be judged."""

ITS_PILLAR = "economics"
A_DIFFERENT_PILLAR = "safety"
THEIR_TYPE = "Count"


def _record_the_catalog(connection: psycopg.Connection) -> None:
    """One criteria set and two attributes: one descriptive, one scoreable, otherwise alike.

    Alike on purpose. The pair differs in exactly the column under test, so nothing else can
    explain a difference in what the database does with them.
    """
    connection.execute("INSERT INTO criteria_set (id, name) VALUES (%s, %s)", (A_SET, A_SET))
    connection.execute(
        """
        INSERT INTO attribute (id, pillar, level, value_type, name)
        VALUES (%s, NULL, 'country', %s, 'Subdivision count'),
               (%s, %s,   'country', %s, 'Motorway length')
        """,
        (A_DESCRIPTIVE_ATTRIBUTE, THEIR_TYPE, A_SCORED_ATTRIBUTE, ITS_PILLAR, THEIR_TYPE),
    )


def _attach_a_criterion(
    connection: psycopg.Connection, *, attribute: str, pillar: str | None
) -> None:
    """Judge an attribute, claiming it belongs to the given pillar."""
    connection.execute(
        """
        INSERT INTO criterion (criteria_set, attribute, pillar, value_type, weight, goal,
                               normalisation_method)
        VALUES (%s, %s, %s, %s, %s, 'maximise', 'percentile')
        """,
        (A_SET, attribute, pillar, THEIR_TYPE, Decimal("10")),
    )


class TestACriterionJudgesAnAttributeThatHasAPillar:
    """A descriptive attribute cannot be scored, and the database is where that is settled."""

    def test_an_attribute_in_a_pillar_can_be_judged(self, connection: psycopg.Connection) -> None:
        """The control. Without it the three refusals below prove nothing.

        Every column of this insert is the one the refusals use; only the pillar differs. So if
        this passes and those fail, the pillar is the reason.
        """
        _record_the_catalog(connection)

        _attach_a_criterion(connection, attribute=A_SCORED_ATTRIBUTE, pillar=ITS_PILLAR)

        stored = connection.execute(
            "SELECT pillar FROM criterion WHERE criteria_set = %s AND attribute = %s",
            (A_SET, A_SCORED_ATTRIBUTE),
        ).fetchone()
        assert stored == (ITS_PILLAR,)

    def test_a_descriptive_attribute_cannot_be_given_a_criterion(
        self, connection: psycopg.Connection
    ) -> None:
        """Naming a real pillar does not help: the attribute is not in it."""
        _record_the_catalog(connection)

        with pytest.raises(errors.ForeignKeyViolation):
            _attach_a_criterion(connection, attribute=A_DESCRIPTIVE_ATTRIBUTE, pillar=ITS_PILLAR)

    def test_a_criterion_cannot_decline_to_name_a_pillar(
        self, connection: psycopg.Connection
    ) -> None:
        """Leaving it out is the other way of attaching a criterion to nothing in particular."""
        _record_the_catalog(connection)

        with pytest.raises(errors.NotNullViolation):
            _attach_a_criterion(connection, attribute=A_DESCRIPTIVE_ATTRIBUTE, pillar=None)

    def test_a_criterion_cannot_claim_a_pillar_its_attribute_is_not_in(
        self, connection: psycopg.Connection
    ) -> None:
        """The restated pillar has to be the attribute's own.

        This is what the composite key buys beyond `NOT NULL`. A criterion filed under `safety`
        while judging an economics attribute would count against the wrong pillar's weights,
        and pillar weights sum to 100 within a level (`reqs.md` 5.2) -- so one pillar would
        quietly total more than it was given and another less.
        """
        _record_the_catalog(connection)

        with pytest.raises(errors.ForeignKeyViolation):
            _attach_a_criterion(connection, attribute=A_SCORED_ATTRIBUTE, pillar=A_DIFFERENT_PILLAR)
