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

from .evaluation_rows import A_SEEDED_ATTRIBUTE, record_an_evaluation
from .evaluation_rows import ITS_PILLAR as A_SEEDED_PILLAR

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


# --- a criterion may only score what carries a comparable figure (0122) ----------------------

A_LABELLED_ATTRIBUTE = "country.climate_zone"
"""Köppen codes. There is no arithmetic that puts `Cfb` above `Dfb` (`reqs.md` 3.3a)."""


def _attach_a_labelled_criterion(connection: psycopg.Connection, *, is_scored: bool) -> None:
    connection.execute(
        """
        INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                               goal, normalisation_method)
        SELECT %s, a.id, a.pillar, a.value_type, %s, 10, 'maximise', 'as_is'
        FROM   attribute AS a WHERE a.id = %s
        """,
        (A_SET, is_scored, A_LABELLED_ATTRIBUTE),
    )


class TestOnlyAComparableFigureCanBeScored:
    """Four of the ten value types carry no number. A criterion that asks to score one would
    hold weight that redistributes away on every candidate for ever, while coverage reported it
    as missing data -- and the figure is not missing, it is not a number."""

    def test_a_label_set_criterion_may_still_be_declared(
        self, connection: psycopg.Connection
    ) -> None:
        """The control, and the point: excluding a criterion is not a downgrade. It still
        matches, still gates through a threshold, and still shows in the drill-down."""
        _record_the_catalog(connection)

        _attach_a_labelled_criterion(connection, is_scored=False)

        stored = connection.execute(
            "SELECT is_scored FROM criterion WHERE criteria_set = %s AND attribute = %s",
            (A_SET, A_LABELLED_ATTRIBUTE),
        ).fetchone()
        assert stored == (False,)

    def test_a_label_set_criterion_may_not_ask_to_be_scored(
        self, connection: psycopg.Connection
    ) -> None:
        _record_the_catalog(connection)

        with pytest.raises(errors.CheckViolation):
            _attach_a_labelled_criterion(connection, is_scored=True)

    def test_a_numeric_criterion_may_ask_to_be_scored(self, connection: psycopg.Connection) -> None:
        """The other control. Count carries a figure, so nothing here is refused."""
        _record_the_catalog(connection)

        _attach_a_criterion(connection, attribute=A_SCORED_ATTRIBUTE, pillar=ITS_PILLAR)

        stored = connection.execute(
            "SELECT is_scored FROM criterion WHERE criteria_set = %s AND attribute = %s",
            (A_SET, A_SCORED_ATTRIBUTE),
        ).fetchone()
        assert stored == (True,)


def test_the_shipped_set_no_longer_asks_to_score_a_label_set(
    connection: psycopg.Connection,
) -> None:
    """The three rows `0122` corrected, checked in the seeded catalog rather than in a fixture.

    They carried 68 weight-points between them across three pillars, and the defect was
    invisible until `evaluation/` existed to try scoring them.
    """
    asking = connection.execute(
        """
        SELECT c.attribute FROM criterion AS c
        JOIN   attribute AS a ON a.id = c.attribute
        WHERE  c.is_scored
          AND  a.value_type IN ('LabelSet', 'ShareComposition', 'Boolean', 'Text')
        """
    ).fetchall()

    assert asking == []


# --- a band needs the method that can draw it (0468) ----------------------------------------


def _aim_at_a_band(connection: psycopg.Connection, *, method: str) -> None:
    """Judge the scoreable attribute with a target range, normalising as told."""
    connection.execute(
        """
        INSERT INTO criterion (criteria_set, attribute, pillar, value_type, weight, goal,
                               normalisation_method, target_range_min, target_range_max)
        VALUES (%s, %s, %s, %s, %s, 'target_range', %s, 18, 26)
        """,
        (A_SET, A_SCORED_ATTRIBUTE, ITS_PILLAR, THEIR_TYPE, Decimal("10"), method),
    )


class TestATargetRangeNeedsAFixedScale:
    """A band is a scale, and `fixed` is the only method that draws one.

    **The combination scored, and scored something else.** `percentile` ranks a column by
    standing and knows nothing of a band; `as_is` reads the figure as a score and inverts it
    unless the goal is `maximise`, so a target range came out scored as a minimisation. The
    domain refuses it now and so does this constraint -- the schema is where a migration, a
    script or a hand-written `psql` session meets the same rule.
    """

    def test_a_band_under_the_fixed_method_is_accepted(
        self, connection: psycopg.Connection
    ) -> None:
        """The control. Every column below is this row's; only the method differs."""
        _record_the_catalog(connection)

        _aim_at_a_band(connection, method="fixed")

        stored = connection.execute(
            "SELECT normalisation_method FROM criterion WHERE criteria_set = %s AND attribute = %s",
            (A_SET, A_SCORED_ATTRIBUTE),
        ).fetchone()
        assert stored == ("fixed",)

    @pytest.mark.parametrize("method", ["percentile", "as_is"], ids=["percentile", "as_is"])
    def test_a_band_the_method_cannot_draw_is_refused(
        self, connection: psycopg.Connection, method: str
    ) -> None:
        _record_the_catalog(connection)

        with pytest.raises(errors.CheckViolation):
            _aim_at_a_band(connection, method=method)

    def test_the_frozen_copy_refuses_it_too(self, connection: psycopg.Connection) -> None:
        """An evaluation stores the interpretation it scored with (`0107`). A combination the
        live catalog refuses must not be storable as a record of what was scored, or the refusal
        would only postpone the nonsense to the page that reads it back.

        Written as a row rather than as a lookup in `pg_constraint`, for the reason at the top
        of this file: a test that finds a constraint by name agrees with whoever typed the name.
        """
        evaluation = record_an_evaluation(connection)

        with pytest.raises(errors.CheckViolation):
            connection.execute(
                """
                INSERT INTO evaluation_criterion
                       (evaluation, attribute, pillar, is_scored, weight, pillar_weight, goal,
                        normalisation_method, blocks_if_missing, target_range_min,
                        target_range_max)
                VALUES (%s, %s, %s, true, 40, 30, 'target_range', 'percentile', false, 18, 26)
                """,
                (evaluation, A_SEEDED_ATTRIBUTE, A_SEEDED_PILLAR),
            )
