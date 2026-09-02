"""What the gate and rule tables refuse, proven by asking them to accept it.

The tables of `0007-gates-and-outside-opinions.sql` carry judgements that are displayed as the
reason a candidate is out, which is the heaviest burden of proof in the product. Two of their
constraints are therefore about what an answer may claim rather than about referential tidiness,
and both are tested here by inserting the row that must be refused.

**Nothing here asserts that a constraint is declared.** A test that reads `pg_constraint` and
finds a name agrees with whoever wrote the name; the mistake was made once already in this suite
(`test_schema_contract.py`, `reqs.md` Q197) and produced a `UNIQUE` that guaranteed nothing for
the common case. Every check below writes a row and reads what the database said about it.
"""

from datetime import UTC, date, datetime

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.storage

A_GATE = "eu_free_movement"
A_CANDIDATE = "country.portugal"
A_PERIOD_START = date(2026, 1, 1)
A_PERIOD_END = date(2026, 12, 31)

A_SHARE_RULE = "rent_against_spend"

THE_HOUSEHOLD_MONEY_FIGURES = ("net_income", "target_monthly_spend", "max_rent")


def _record_a_gate_answer(
    connection: psycopg.Connection, *, start: date | None, end: date | None
) -> None:
    """One researched gate answer, carrying whichever half of a reference period is given."""
    connection.execute(
        """
        INSERT INTO match_rule_result (match_rule, candidate, match_result, data_source,
                                       reference_period_start, reference_period_end,
                                       retrieval_date)
        VALUES (%s, %s, 'matching', 'manual', %s, %s, %s)
        """,
        (A_GATE, A_CANDIDATE, start, end, datetime.now(UTC)),
    )


def _gate_answers(connection: psycopg.Connection) -> int:
    return connection.execute(
        "SELECT count(*) FROM match_rule_result WHERE match_rule = %s AND candidate = %s",
        (A_GATE, A_CANDIDATE),
    ).fetchone()[0]


class TestAGateAnswerReferencePeriod:
    """A span, or nothing. Never one end of one (`reqs.md` 3.6)."""

    @pytest.mark.parametrize(
        ("start", "end"),
        [(A_PERIOD_START, None), (None, A_PERIOD_END)],
        ids=["a start with no end", "an end with no start"],
    )
    def test_half_a_period_is_refused(
        self, connection: psycopg.Connection, start: date | None, end: date | None
    ) -> None:
        """Half a period does not say what the judgement holds for, which is its whole job.

        `ReferencePeriod` requires both ends, so a half-recorded row is one the domain cannot
        construct -- it would be read out of the database and refused on the way in.
        """
        with pytest.raises(errors.CheckViolation) as refused:
            _record_a_gate_answer(connection, start=start, end=end)

        assert (
            refused.value.diag.constraint_name
            == "match_rule_result_reference_period_is_all_or_nothing"
        )

    def test_a_whole_period_is_recorded(self, connection: psycopg.Connection) -> None:
        _record_a_gate_answer(connection, start=A_PERIOD_START, end=A_PERIOD_END)

        assert _gate_answers(connection) == 1

    def test_no_period_at_all_is_recorded(self, connection: psycopg.Connection) -> None:
        """The common case, and legal: nobody recorded a period.

        That is an answer with no expiry rather than an answer that never expires, and refusing
        it would force whoever researched the gate to invent a span the source never stated.
        """
        _record_a_gate_answer(connection, start=None, end=None)

        assert _gate_answers(connection) == 1


def _declare_a_share_rule(connection: psycopg.Connection) -> None:
    """A `ShareOfHouseholdField` rule with no ceiling, which is the shipping state of a rule.

    Its threshold is left NULL deliberately: what a rule compares against is Alex's to decide
    (`devplan.md` 0.3 rule 2), and a test needs the row rather than the number.
    """
    connection.execute(
        """
        INSERT INTO compound_rule (id, name, level, shape, outcome, threshold_max)
        VALUES (%s, 'Rent against spend', 'country', 'ShareOfHouseholdField', 'warning', NULL)
        """,
        (A_SHARE_RULE,),
    )


def _read_a_household_field(connection: psycopg.Connection, field: str) -> None:
    connection.execute(
        """
        INSERT INTO compound_rule_input (compound_rule, shape, input_order, household_field)
        VALUES (%s, 'ShareOfHouseholdField', 1, %s)
        """,
        (A_SHARE_RULE, field),
    )


class TestTheHouseholdFieldVocabulary:
    """What a `ShareOfHouseholdField` rule is allowed to measure a figure against.

    The vocabulary is what makes the shape usable at all: `compound_rule_input.household_field`
    is a foreign key, so an empty table means every rule of this shape is refused and the shape
    is dead rather than merely unused.
    """

    @pytest.mark.parametrize("field", THE_HOUSEHOLD_MONEY_FIGURES)
    def test_a_rule_may_read_a_household_money_figure(
        self, connection: psycopg.Connection, field: str
    ) -> None:
        _declare_a_share_rule(connection)

        _read_a_household_field(connection, field)

        assert (
            connection.execute(
                "SELECT count(*) FROM compound_rule_input WHERE compound_rule = %s",
                (A_SHARE_RULE,),
            ).fetchone()[0]
            == 1
        )

    @pytest.mark.parametrize(
        "field",
        ["number_children", "size", "savings"],
        ids=["a person count", "a household size", "a figure nobody records"],
    )
    def test_a_rule_may_not_read_anything_else(
        self, connection: psycopg.Connection, field: str
    ) -> None:
        """A share of a person count is not a quantity, and a share of a field that does not
        exist is nothing at all. Both are refused by the same key, which is the point of
        holding the vocabulary in a table."""
        _declare_a_share_rule(connection)

        with pytest.raises(errors.ForeignKeyViolation):
            _read_a_household_field(connection, field)

    def test_the_vocabulary_is_the_money_figures_and_nothing_else(
        self, connection: psycopg.Connection
    ) -> None:
        """Seeding a fourth would be a decision about what a rule may ask, made in a migration.

        Asserted as an exact set rather than as membership, because the failure this guards
        against is an id arriving, not one going missing.
        """
        seeded = connection.execute("SELECT id FROM household_field").fetchall()

        assert {row[0] for row in seeded} == set(THE_HOUSEHOLD_MONEY_FIGURES)
