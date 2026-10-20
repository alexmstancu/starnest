"""What the rules say, and what they refuse to say (`reqs.md` 3.7, 3.7a, 5.4).

The rule that shapes this module: **an undecided rule does not fire**. Every threshold the MVP
ships is TBD, and firing one on a number nobody chose is the fabricated judgement this
application exists to prevent (`devplan.md` D5).
"""

from datetime import UTC, datetime
from decimal import Decimal

from starnest.criteria import (
    BooleanThreshold,
    LabelThreshold,
    RangeThreshold,
    ShareThreshold,
)
from starnest.data import (
    Boolean,
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleInput,
    CompoundRuleShape,
    Count,
    LabelSet,
    MatchResult,
    MatchRuleResult,
    RuleOutcome,
    Share,
    ShareComposition,
    ValueType,
)
from starnest.evaluation import (
    gates_that_rule_out,
    judgements_of,
    thresholds_that_rule_out,
)

from .builders import a_criterion, a_value

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

    def test_a_warning_records_the_value_rows_its_conditions_read(self) -> None:
        """ST-07: the warning keeps the ids of the figures it fired on, in condition order, so a
        saved evaluation can be reopened to the source and date behind each."""
        warnings, _ = judgements_of(
            rules=[a_rule()],
            figures=FIGURES,
            level="country",
            value_ids={PRICES: 101, TAX: 202},
        )

        (warning,) = warnings
        assert warning.input_values == (101, 202)

    def test_a_warning_with_no_value_ids_keeps_an_empty_chain(self) -> None:
        """Bare magnitudes were passed, so there is nothing to point at -- the honest empty
        chain, not a guess."""
        (warning,), _ = judged(a_rule())

        assert warning.input_values == ()

    def test_the_detail_shows_the_figures_that_made_it_fire(self) -> None:
        (warning,), _ = judged(a_rule())

        assert "65.1" in warning.detail
        assert "52.0" in warning.detail
        assert warning.detail.startswith("Cheap but taxed:")

    def test_the_detail_names_the_attribute_rather_than_its_key(self) -> None:
        """**The sentence is rendered verbatim** in the ranking's "Why this status" column, and
        `reqs.md` asks the interface to show no programmatic identifier. The id was all this
        function had until the catalog read started joining the name on."""
        rule = a_rule()
        named = rule.model_copy(
            update={
                "conditions": tuple(
                    condition.model_copy(
                        update={"attribute_name": "Cost of living index"}
                        if condition.ordinal == 1
                        else {"attribute_name": "Total effective tax rate"}
                    )
                    for condition in rule.conditions
                )
            }
        )

        (warning,), _ = judged(named)

        assert "Cost of living index" in warning.detail
        assert "Total effective tax rate" in warning.detail
        assert str(PRICES) not in warning.detail
        assert str(TAX) not in warning.detail

    def test_the_detail_falls_back_to_the_key_when_no_name_was_read(self) -> None:
        """An explanation naming the key is still better than no explanation, and a condition
        built without the catalog in hand -- in a test, or from an older row -- has no name."""
        (warning,), _ = judged(a_rule())

        assert str(PRICES) in warning.detail

    def test_a_derived_figure_is_read_at_a_readable_precision(self) -> None:
        """**Found on screen, 2026-09-20.** The estimated tax rate is a division, so it arrives
        as `43.32847052546540994843612212`, and the detail interpolated it whole: a warning that
        is correct and unreadable, sitting in a ranking beside figures printed to one decimal.
        The bounds were already formatted; the figures were not.
        """
        derived = {PRICES: Decimal("65.1"), TAX: Decimal("52.32847052546540994843612212")}

        (warning,), _ = judged(a_rule(), derived)

        assert "52.3285" in warning.detail
        assert "52.32847052546540994843612212" not in warning.detail

    def test_a_figure_already_readable_is_printed_exactly_as_it_arrived(self) -> None:
        """**The formatting only ever shortens.** How many decimals a publisher printed is
        itself information, and `Decimal.normalize()` -- the obvious way to tidy a trailing
        zero -- renders 60 as `6E+1`, so neither is done.
        """
        whole = {PRICES: Decimal("60.00"), TAX: Decimal("52.0")}

        (warning,), _ = judged(a_rule(), whole)

        assert "60.00" in warning.detail
        assert "52.0" in warning.detail
        assert "6E+1" not in warning.detail

    def test_one_condition_failing_is_enough_to_stay_silent(self) -> None:
        """AND is the only connective, and it is implicit in the shape (`reqs.md` 3.7a)."""
        expensive = {PRICES: Decimal("108.3"), TAX: Decimal("52.0")}

        assert judged(a_rule(), expensive) == ((), ())

    def test_an_undecided_rule_never_fires(self) -> None:
        """A rule with no bound on either condition is one nobody has finished writing, so it
        fires for no one -- whatever the catalog's shipped rules happen to be decided to."""
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


class TestAProposalRulesNothingOut:
    """A gate a model researched is a proposal until a human writes it (`reqs.md` 6.10 use 3).

    **Excluding a country because a model said so, with nobody having looked, is the failure the
    whole inventory of permitted LLM uses exists to prevent.** So the proposal is stored, shown
    with its sources, and counted by nothing.
    """

    def test_a_proposed_failure_does_not_rule_the_candidate_out(self) -> None:
        proposal = an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "a model read a page")

        assert (
            gates_that_rule_out(
                enforced=["uk_skilled_worker"],
                answers=[proposal.model_copy(update={"is_proposal": True})],
            )
            == ()
        )

    def test_the_same_answer_confirmed_does_rule_it_out(self) -> None:
        """The control, and the only difference between the two is who answered."""
        confirmed = an_answer(
            "uk_skilled_worker", MatchResult.NOT_MATCHING, "somebody read the page"
        )

        (non_match,) = gates_that_rule_out(enforced=["uk_skilled_worker"], answers=[confirmed])

        assert str(non_match.match_rule) == "uk_skilled_worker"
        assert non_match.reason_detail == "somebody read the page"


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


def _verdict(threshold, value_type, payload):
    """One criterion with `threshold`, one candidate whose value carries `payload`."""
    criterion = a_criterion(value_type=value_type, matching_threshold=threshold)
    value = a_value(value_type=value_type, payload=payload)
    return thresholds_that_rule_out([criterion], [value])


class TestMatchingThresholds:
    """A criterion's own hard line on its one attribute's figure -- the third way a candidate
    does not match (`reqs.md` 5.2, BE-01). A value past the line rules it out; a value it cannot
    judge (missing, rejected) never does."""

    def test_a_figure_above_the_maximum_is_ruled_out(self) -> None:
        out = _verdict(RangeThreshold(max_value=Decimal(50)), ValueType.COUNT, Count(count=90))

        assert len(out) == 1
        assert out[0].criterion is not None
        assert "above your maximum" in out[0].reason_detail

    def test_a_figure_below_the_minimum_is_ruled_out(self) -> None:
        out = _verdict(RangeThreshold(min_value=Decimal(50)), ValueType.COUNT, Count(count=10))

        assert "below your minimum" in out[0].reason_detail

    def test_a_figure_inside_the_band_is_admitted(self) -> None:
        inside = _verdict(
            RangeThreshold(min_value=Decimal(10), max_value=Decimal(90)),
            ValueType.COUNT,
            Count(count=50),
        )

        assert inside == ()

    def test_the_bounds_are_inclusive(self) -> None:
        """On the line is inside it, like every other bound in the system (`reqs.md` 5.2)."""
        on_the_max = _verdict(
            RangeThreshold(max_value=Decimal(50)), ValueType.COUNT, Count(count=50)
        )

        assert on_the_max == ()

    def test_must_contain_rules_out_when_the_label_is_absent(self) -> None:
        out = _verdict(
            LabelThreshold(label="temperate", containment_rule="must_contain"),
            ValueType.LABEL_SET,
            LabelSet(labels=("continental",)),
        )

        assert "does not carry 'temperate'" in out[0].reason_detail

    def test_must_contain_is_admitted_when_the_label_is_present(self) -> None:
        out = _verdict(
            LabelThreshold(label="temperate", containment_rule="must_contain"),
            ValueType.LABEL_SET,
            LabelSet(labels=("temperate", "oceanic")),
        )

        assert out == ()

    def test_must_not_contain_rules_out_when_the_label_is_present(self) -> None:
        out = _verdict(
            LabelThreshold(label="tropical", containment_rule="must_not_contain"),
            ValueType.LABEL_SET,
            LabelSet(labels=("tropical", "humid")),
        )

        assert "ruled out" in out[0].reason_detail

    def test_must_not_contain_is_admitted_when_the_label_is_absent(self) -> None:
        out = _verdict(
            LabelThreshold(label="tropical", containment_rule="must_not_contain"),
            ValueType.LABEL_SET,
            LabelSet(labels=("temperate",)),
        )

        assert out == ()

    def test_a_boolean_that_is_not_the_required_answer_is_ruled_out(self) -> None:
        out = _verdict(
            BooleanThreshold(required_value=False), ValueType.BOOLEAN, Boolean(value=True)
        )

        assert "require False" in out[0].reason_detail

    def test_a_boolean_that_matches_is_admitted(self) -> None:
        out = _verdict(
            BooleanThreshold(required_value=True), ValueType.BOOLEAN, Boolean(value=True)
        )

        assert out == ()

    def test_a_share_over_the_maximum_is_ruled_out(self) -> None:
        composition = ShareComposition(
            shares=(
                Share(label="muslim", share=Decimal(45)),
                Share(label="other", share=Decimal(55)),
            )
        )

        out = _verdict(
            ShareThreshold(label="muslim", max_share=Decimal(30)),
            ValueType.SHARE_COMPOSITION,
            composition,
        )

        assert "above your maximum" in out[0].reason_detail

    def test_a_share_within_its_bounds_is_admitted(self) -> None:
        composition = ShareComposition(
            shares=(
                Share(label="muslim", share=Decimal(20)),
                Share(label="other", share=Decimal(80)),
            )
        )

        out = _verdict(
            ShareThreshold(label="muslim", max_share=Decimal(30)),
            ValueType.SHARE_COMPOSITION,
            composition,
        )

        assert out == ()

    def test_a_label_absent_from_the_composition_counts_as_zero_share(self) -> None:
        composition = ShareComposition(shares=(Share(label="other", share=Decimal(100)),))

        out = _verdict(
            ShareThreshold(label="muslim", min_share=Decimal(10)),
            ValueType.SHARE_COMPOSITION,
            composition,
        )

        assert "below your minimum" in out[0].reason_detail

    def test_a_criterion_with_no_threshold_rules_nothing_out(self) -> None:
        assert thresholds_that_rule_out([a_criterion()], [a_value(payload=Count(count=90))]) == ()

    def test_an_unscored_criterion_is_judged_like_any_other(self) -> None:
        """Whether a criterion is scored decides its weight, never its line (BE-01)."""
        excluded = a_criterion(
            is_scored=False, matching_threshold=RangeThreshold(max_value=Decimal(50))
        )

        out = thresholds_that_rule_out([excluded], [a_value(payload=Count(count=90))])

        assert [str(reason.criterion) for reason in out] == [str(excluded.attribute)]

    def test_a_threshold_with_no_figure_for_the_attribute_rules_nothing_out(self) -> None:
        """You cannot cross a line you have no figure for -- that is insufficient coverage, not a
        non-match (`reqs.md` 5.3)."""
        criterion = a_criterion(matching_threshold=RangeThreshold(max_value=Decimal(50)))

        assert thresholds_that_rule_out([criterion], []) == ()

    def test_a_rejected_value_rules_nothing_out(self) -> None:
        """A value that holds no figure (it was rejected) cannot be judged against a line."""
        criterion = a_criterion(matching_threshold=RangeThreshold(max_value=Decimal(50)))
        rejected = a_value(payload=None, rejection_reason="figure outside the credible range")

        assert thresholds_that_rule_out([criterion], [rejected]) == ()

    def test_the_reason_names_the_criterion_by_its_attribute(self) -> None:
        out = _verdict(RangeThreshold(max_value=Decimal(50)), ValueType.COUNT, Count(count=90))

        assert str(out[0].criterion) == str(a_criterion().attribute)
        assert out[0].match_rule is None and out[0].compound_rule is None

    def test_only_the_criterion_whose_line_is_crossed_is_named(self) -> None:
        crossed = a_criterion(
            attribute="country.overcrowding_rate",
            matching_threshold=RangeThreshold(max_value=Decimal(50)),
        )
        within = a_criterion(
            attribute="country.life_satisfaction",
            matching_threshold=RangeThreshold(max_value=Decimal(50)),
        )
        values = [
            a_value(attribute="country.overcrowding_rate", payload=Count(count=90)),
            a_value(attribute="country.life_satisfaction", payload=Count(count=10)),
        ]

        out = thresholds_that_rule_out([crossed, within], values)

        assert [str(reason.criterion) for reason in out] == ["country.overcrowding_rate"]
