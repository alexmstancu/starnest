"""What the rules say, and what they refuse to say (`reqs.md` 3.7, 3.7a, 5.4).

The rule that shapes this module: **an undecided rule does not fire**. Every threshold the MVP
ships is TBD, and firing one on a number nobody chose is the fabricated judgement this
application exists to prevent (`devplan.md` D5).
"""

from datetime import UTC, datetime
from decimal import Decimal

from starnest.data import (
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleInput,
    CompoundRuleShape,
    MatchResult,
    MatchRuleResult,
    RuleOutcome,
)
from starnest.evaluation import gates_that_rule_out, judgements_of

PRICES = "country.cost_of_living_index"
TAX = "country.total_tax_rate_effective"
FIGURES = {PRICES: Decimal("65.1"), TAX: Decimal("52.0")}


def a_rule(
    *,
    outcome: RuleOutcome = RuleOutcome.WARNING,
    level: str | None = "country",
    prices_max: str | None = "80",
    tax_min: str | None = "45",
    shape: CompoundRuleShape = CompoundRuleShape.ALL_CONDITIONS_HOLD,
) -> CompoundRule:
    """`cheap_but_taxed`: cheap to live in, and heavily taxed. Undecided unless given numbers."""
    return CompoundRule(
        id="cheap_but_taxed",
        name="Cheap but taxed",
        level=level,
        shape=shape,
        outcome=outcome,
        conditions=(
            CompoundRuleCondition(
                ordinal=1,
                attribute=PRICES,
                threshold_max=None if prices_max is None else Decimal(prices_max),
            ),
            CompoundRuleCondition(
                ordinal=2,
                attribute=TAX,
                threshold_min=None if tax_min is None else Decimal(tax_min),
            ),
        ),
    )


def judged(rule: CompoundRule, figures: dict[str, Decimal] | None = None, level: str = "country"):
    return judgements_of(rules=[rule], figures=FIGURES if figures is None else figures, level=level)


class TestACompoundRule:
    def test_it_fires_when_every_condition_holds(self) -> None:
        """65.1 is below 80 and 52.0 is above 45: cheap to live in and heavily taxed."""
        warnings, non_matches = judged(a_rule())

        assert [str(w.compound_rule) for w in warnings] == ["cheap_but_taxed"]
        assert non_matches == ()

    def test_the_detail_shows_the_figures_that_made_it_fire(self) -> None:
        (warning,), _ = judged(a_rule())

        assert "65.1" in warning.detail
        assert "52.0" in warning.detail
        assert warning.detail.startswith("Cheap but taxed:")

    def test_one_condition_failing_is_enough_to_stay_silent(self) -> None:
        """AND is the only connective, and it is implicit in the shape (`reqs.md` 3.7a)."""
        expensive = {PRICES: Decimal("108.3"), TAX: Decimal("52.0")}

        assert judged(a_rule(), expensive) == ((), ())

    def test_an_undecided_rule_never_fires(self) -> None:
        """Both rules the MVP ships are undecided, and that is the intended state."""
        assert judged(a_rule(prices_max=None, tax_min=None)) == ((), ())

    def test_a_half_decided_rule_never_fires(self) -> None:
        """One condition without a bound is one nobody has finished writing."""
        assert judged(a_rule(tax_min=None)) == ((), ())

    def test_a_missing_figure_does_not_satisfy_a_condition(self) -> None:
        """An unmeasured condition is not a satisfied one: treating absence as agreement would
        flag candidates for what nobody found."""
        assert judged(a_rule(), {PRICES: Decimal("65.1")}) == ((), ())

    def test_a_rule_for_another_level_is_not_applied(self) -> None:
        assert judged(a_rule(level="city")) == ((), ())

    def test_a_rule_with_no_level_applies_everywhere(self) -> None:
        warnings, _ = judged(a_rule(level=None))

        assert len(warnings) == 1

    def test_an_outcome_of_not_matching_rules_the_candidate_out(self) -> None:
        warnings, (non_match,) = judged(a_rule(outcome=RuleOutcome.NOT_MATCHING))

        assert warnings == ()
        assert str(non_match.compound_rule) == "cheap_but_taxed"
        assert non_match.match_rule is None

    def test_a_shape_that_is_not_built_stays_silent(self) -> None:
        """`ShareOfHouseholdField` and `SumBelowFloor` read a household field and a sum of
        inputs; they belong to the city level and arrive with it. Silence is the same answer an
        undecided rule gets, rather than a guess.

        **Fully decided on purpose**, which this test did not used to be: with no inputs the
        rule was undecided, so it was filtered out before the shape was ever looked at and the
        test passed without touching the branch it names. It has inputs and a ceiling now, so
        the only thing that can keep it silent is the shape.
        """
        other = CompoundRule(
            id="rent_against_spend",
            name="Rent against spend",
            level="country",
            shape=CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD,
            outcome=RuleOutcome.WARNING,
            threshold_max=Decimal("40"),
            inputs=(
                CompoundRuleInput(input_order=1, attribute="country.average_rent"),
                CompoundRuleInput(input_order=2, household_field="target_monthly_spend"),
            ),
        )
        assert other.is_decided

        assert judgements_of(rules=[other], figures=FIGURES, level="country") == ((), ())


def an_answer(rule: str, result: MatchResult, reason: str | None = None) -> MatchRuleResult:
    return MatchRuleResult(
        match_rule=rule,
        candidate="country.united_kingdom",
        match_result=result,
        data_source="manual",
        retrieval_date=datetime(2026, 9, 12, tzinfo=UTC),
        reason=reason,
    )


class TestTheGates:
    def test_an_enforced_gate_answered_not_matching_rules_the_candidate_out(self) -> None:
        (non_match,) = gates_that_rule_out(
            enforced=["uk_skilled_worker"],
            answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "no sponsor")],
        )

        assert str(non_match.match_rule) == "uk_skilled_worker"
        assert non_match.reason_detail == "no sponsor"
        assert non_match.compound_rule is None

    def test_an_answer_with_no_reason_still_says_which_gate(self) -> None:
        (non_match,) = gates_that_rule_out(
            enforced=["uk_skilled_worker"],
            answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING)],
        )

        assert "uk_skilled_worker" in non_match.reason_detail

    def test_unknown_rules_nothing_out(self) -> None:
        """A gate nobody has researched is a question, not a failure."""
        assert (
            gates_that_rule_out(
                enforced=["uk_skilled_worker"],
                answers=[an_answer("uk_skilled_worker", MatchResult.UNKNOWN)],
            )
            == ()
        )

    def test_matching_rules_nothing_out(self) -> None:
        assert (
            gates_that_rule_out(
                enforced=["uk_skilled_worker"],
                answers=[an_answer("uk_skilled_worker", MatchResult.MATCHING)],
            )
            == ()
        )

    def test_a_gate_the_set_does_not_enforce_is_not_consulted(self) -> None:
        """Whether a gate counts is the criteria set's preference (`arch.md` 3.6)."""
        assert (
            gates_that_rule_out(
                enforced=[],
                answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "no sponsor")],
            )
            == ()
        )
