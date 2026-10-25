"""What the rules say, and what they refuse to say (`reqs.md` 3.7, 3.7a, 5.4).

The rule that shapes this module: **an undecided rule does not fire**. Every threshold the MVP
ships is TBD, and firing one on a number nobody chose is the fabricated judgement this
application exists to prevent (`devplan.md` D5).
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import ClassVar

import pytest

from starnest.criteria import (
    BooleanThreshold,
    LabelThreshold,
    NormalisationMethod,
    RangeThreshold,
    ShareThreshold,
)
from starnest.data import (
    AssignedScore,
    Boolean,
    ClearingCitizenship,
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleInput,
    CompoundRuleShape,
    Count,
    LabelSet,
    MatchResult,
    MatchRule,
    MatchRuleResult,
    ReferencePeriod,
    RuleOutcome,
    Share,
    ShareComposition,
    ValueType,
)
from starnest.evaluation import (
    describe_compound_rule,
    gates_that_rule_out,
    gates_that_warn,
    judgements_of,
    thresholds_that_rule_out,
)
from starnest.evaluation.rules import Citizenship
from starnest.evaluation.wording import Names

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

        assert "65.1, at most 80" in warning.detail
        assert "52, at least 45" in warning.detail
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

    def test_the_detail_falls_back_to_a_readable_name_never_the_key(self) -> None:
        """A condition built without the catalog in hand -- in a test, or from an older row --
        has no name, and the sentence is read verbatim on screen (PL-067)."""
        (warning,), _ = judged(a_rule())

        assert "Cost of living index 65.1" in warning.detail
        assert str(PRICES) not in warning.detail

    def test_the_names_passed_in_are_used_with_their_units(self) -> None:
        (warning,), _ = judgements_of(
            rules=[a_rule()],
            figures=FIGURES,
            level="country",
            names=Names(
                attributes={TAX: "Total tax rate"},
                units={PRICES: "index where the EU27 average is 100", TAX: "%"},
            ),
        )

        assert "index where the EU27 average is 100, at most 80" in warning.detail
        assert "Total tax rate 52%, at least 45" in warning.detail

    def test_a_derived_figure_is_read_at_a_readable_precision(self) -> None:
        """**Found on screen, 2026-09-20.** The estimated tax rate is a division, so it arrives
        as `43.32847052546540994843612212`, and the detail interpolated it whole: a warning that
        is correct and unreadable, sitting in a ranking beside figures printed to one decimal.
        """
        derived = {PRICES: Decimal("65.1"), TAX: Decimal("52.32847052546540994843612212")}

        (warning,), _ = judged(a_rule(), derived)

        assert "52.33" in warning.detail
        assert "52.328" not in warning.detail

    def test_a_round_figure_never_reads_as_an_exponent(self) -> None:
        """`Decimal.normalize()`, the obvious way to tidy a trailing zero, renders 60 as
        `6E+1`."""
        whole = {PRICES: Decimal("60.00"), TAX: Decimal("6E+1")}

        (warning,), _ = judged(a_rule(), whole)

        assert "Cost of living index 60," in warning.detail
        assert "Total tax rate effective 60," in warning.detail
        assert "E+" not in warning.detail

    def test_a_band_open_on_one_side_never_reads_to_any(self) -> None:
        (warning,), _ = judged(a_rule())

        assert "to any" not in warning.detail

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


class TestACompoundRuleDescribed:
    """What a rule tests, in words, for the rule's row in Configure (PL-155, UF-039).

    Written from its conditions -- names and bands -- so it cannot disagree with them, and
    never an identifier or a vocabulary token.
    """

    UNITS: ClassVar[Names] = Names(
        attributes={PRICES: "Cost of living index", TAX: "Total tax rate"},
        units={TAX: "%"},
    )

    def test_it_names_each_condition_with_its_band_and_unit(self) -> None:
        described = describe_compound_rule(a_rule(), self.UNITS)

        assert described == (
            "Applies when Cost of living index is at most 80 and Total tax rate is at least 45%."
        )

    def test_a_band_closed_on_both_sides_reads_between(self) -> None:
        rule = a_rule().model_copy(
            update={
                "conditions": (
                    CompoundRuleCondition(
                        ordinal=1,
                        attribute="country.avg_annual_temperature",
                        threshold_min=Decimal("10"),
                        threshold_max=Decimal("16"),
                    ),
                )
            }
        )

        described = describe_compound_rule(
            rule, Names(units={"country.avg_annual_temperature": "degrees Celsius"})
        )

        assert "Avg annual temperature is between 10 and 16 degrees Celsius" in described

    def test_it_reads_the_same_whatever_the_catalog_says_the_rule_does(self) -> None:
        # A set may hold the rule as a gate or a warning (0516), so the words must not take
        # either side: the catalog's outcome written here would contradict half the sets.
        as_a_warning = describe_compound_rule(a_rule(outcome=RuleOutcome.WARNING), self.UNITS)
        as_a_gate = describe_compound_rule(a_rule(outcome=RuleOutcome.NOT_MATCHING), self.UNITS)

        assert as_a_warning == as_a_gate

    def test_an_undecided_condition_says_no_bound_is_set(self) -> None:
        described = describe_compound_rule(a_rule(prices_max=None, tax_min=None), self.UNITS)

        assert "Cost of living index has no bound set" in described
        assert "Total tax rate has no bound set" in described

    def test_without_names_it_reads_the_identifier_never_prints_it(self) -> None:
        described = describe_compound_rule(a_rule())

        assert "Cost of living index is at most 80" in described
        assert PRICES not in described
        assert TAX not in described

    def test_a_share_of_a_household_figure_names_both_sides(self) -> None:
        rule = CompoundRule(
            id="rent_against_spend",
            name="Rent against spend",
            level="city",
            shape=CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD,
            outcome=RuleOutcome.WARNING,
            threshold_max=Decimal("0.40"),
            inputs=(
                CompoundRuleInput(input_order=1, attribute="city.average_rent"),
                CompoundRuleInput(input_order=2, household_field="target_monthly_spend"),
            ),
        )

        assert describe_compound_rule(rule, Names(attributes={"city.average_rent": "Rent"})) == (
            "Applies when Rent is more than 40% of the household's target monthly spend."
        )

    def test_a_sum_names_every_figure_it_adds(self) -> None:
        rule = CompoundRule(
            id="two_incomes",
            name="Two incomes",
            level="city",
            shape=CompoundRuleShape.SUM_BELOW_FLOOR,
            outcome=RuleOutcome.NOT_MATCHING,
            threshold_min=Decimal("12"),
            inputs=(
                CompoundRuleInput(input_order=1, attribute="city.tech_software_jobs"),
                CompoundRuleInput(input_order=2, attribute="city.tech_product_jobs"),
            ),
        )

        assert describe_compound_rule(rule) == (
            "Applies when Tech software jobs plus Tech product jobs is below 12."
        )

    def test_a_shape_with_no_bound_chosen_says_so(self) -> None:
        rule = CompoundRule(
            id="two_incomes",
            name="Two incomes",
            level="city",
            shape=CompoundRuleShape.SUM_BELOW_FLOOR,
            outcome=RuleOutcome.NOT_MATCHING,
            inputs=(CompoundRuleInput(input_order=1, attribute="city.tech_software_jobs"),),
        )

        assert describe_compound_rule(rule) == (
            "Applies when Tech software jobs is below a floor not yet chosen."
        )


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

    def test_a_gate_that_rules_out_carries_the_answer_it_read(self) -> None:
        """So a saved refusal can pin the version it read (FU-A4)."""
        read = an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "no sponsor").model_copy(
            update={"id": 7}
        )

        (non_match,) = gates_that_rule_out(enforced=["uk_skilled_worker"], answers=[read])

        assert non_match.gate_answer == read
        assert non_match.input_values == ()

    def test_an_answer_with_no_reason_still_says_which_gate(self) -> None:
        (non_match,) = gates_that_rule_out(
            enforced=["uk_skilled_worker"],
            answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING)],
        )

        assert (
            non_match.reason_detail
            == "Uk skilled worker answered not matching, with no reason recorded"
        )

    def test_a_gate_with_no_reason_is_named_as_the_catalog_names_it(self) -> None:
        (non_match,) = gates_that_rule_out(
            enforced=["uk_skilled_worker"],
            answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING)],
            names=Names(gates={"uk_skilled_worker": "UK skilled worker visa"}),
        )

        assert non_match.reason_detail == (
            "UK skilled worker visa answered not matching, with no reason recorded"
        )

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

    def test_an_answer_whose_period_has_ended_still_rules_out(self) -> None:
        """A confirmed answer is never auto-expired (the household's policy, 2026-10-13): it
        applies until a person changes it, and the screen marks its ended period instead."""
        period = ReferencePeriod(start=date(2020, 1, 1), end=date(2020, 12, 31))
        ended = an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "no sponsor").model_copy(
            update={"reference_period": period}
        )

        (non_match,) = gates_that_rule_out(enforced=["uk_skilled_worker"], answers=[ended])

        assert str(non_match.match_rule) == "uk_skilled_worker"

    def test_a_gate_the_set_does_not_enforce_is_not_consulted(self) -> None:
        """Whether a gate counts is the criteria set's preference (`arch.md` 3.6)."""
        assert (
            gates_that_rule_out(
                enforced=[],
                answers=[an_answer("uk_skilled_worker", MatchResult.NOT_MATCHING, "no sponsor")],
            )
            == ()
        )


def _a_method_it_permits(value_type: ValueType) -> dict[str, NormalisationMethod]:
    """An assigned score is read `as_is` only; every other type here takes the default."""
    if value_type is ValueType.ASSIGNED_SCORE:
        return {"normalisation_method": NormalisationMethod.AS_IS}
    return {}


def _on_ten(score: str) -> AssignedScore:
    return AssignedScore(
        value=Decimal(score), range_min=Decimal(0), range_max=Decimal(10), assigned_by="human"
    )


def _verdict(threshold, value_type, payload):
    """One criterion with `threshold`, one candidate whose value carries `payload`."""
    criterion = a_criterion(
        value_type=value_type,
        matching_threshold=threshold,
        **_a_method_it_permits(value_type),
    )
    value = a_value(value_type=value_type, payload=payload)
    return thresholds_that_rule_out([criterion], [value])


class TestAThresholdNamesTheFigureItJudged:
    """FU-A3: the id of the very value that crossed the line, whatever its type -- including the
    ones no score reads, which a figure-only lookup would silently lose."""

    @pytest.mark.parametrize(
        ("threshold", "value_type", "payload"),
        [
            (RangeThreshold(max_value=Decimal(50)), ValueType.COUNT, Count(count=90)),
            (
                LabelThreshold(label="temperate", containment_rule="must_contain"),
                ValueType.LABEL_SET,
                LabelSet(labels=("continental",)),
            ),
            (BooleanThreshold(required_value=False), ValueType.BOOLEAN, Boolean(value=True)),
            (
                ShareThreshold(label="muslim", max_share=Decimal(30)),
                ValueType.SHARE_COMPOSITION,
                ShareComposition(
                    shares=(
                        Share(label="muslim", share=Decimal(45)),
                        Share(label="other", share=Decimal(55)),
                    )
                ),
            ),
        ],
        ids=["range", "label", "boolean", "share"],
    )
    def test_a_crossed_threshold_names_the_value_it_judged(
        self, threshold, value_type, payload
    ) -> None:
        criterion = a_criterion(value_type=value_type, matching_threshold=threshold)
        value = a_value(value_type=value_type, payload=payload, id=41)

        (out,) = thresholds_that_rule_out([criterion], [value])

        assert out.input_values == (41,)
        assert out.gate_answer is None

    def test_a_value_never_stored_names_nothing(self) -> None:
        out = _verdict(RangeThreshold(max_value=Decimal(50)), ValueType.COUNT, Count(count=90))

        assert out[0].input_values == ()


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

    @pytest.mark.parametrize(("score", "ruled_out"), [("7", False), ("5", False), ("3", True)])
    def test_a_threshold_on_an_assigned_score_reads_it_on_its_own_scale(
        self, score: str, ruled_out: bool
    ) -> None:
        """C06-S1, N2: 7 on 0-10 is 70% of its scale, above a minimum of 50, never "7"."""
        out = _verdict(
            RangeThreshold(min_value=Decimal(50)), ValueType.ASSIGNED_SCORE, _on_ten(score)
        )

        assert bool(out) is ruled_out

    def test_a_maximum_on_an_assigned_score_reads_it_on_its_own_scale_too(self) -> None:
        out = _verdict(
            RangeThreshold(max_value=Decimal(80)), ValueType.ASSIGNED_SCORE, _on_ten("9")
        )

        assert "90% of its scale (9 on 0 to 10), above your maximum of 80%" in (
            out[0].reason_detail
        )

    def test_the_reason_reads_a_percentage_of_the_scale_not_the_raw_figure(self) -> None:
        out = _verdict(
            RangeThreshold(min_value=Decimal(50)), ValueType.ASSIGNED_SCORE, _on_ten("3")
        )

        assert "is 30% of its scale (3 on 0 to 10), below your minimum of 50%" in (
            out[0].reason_detail
        )

    def test_must_contain_rules_out_when_the_label_is_absent(self) -> None:
        out = _verdict(
            LabelThreshold(label="temperate", containment_rule="must_contain"),
            ValueType.LABEL_SET,
            LabelSet(labels=("continental",)),
        )

        assert "does not include \u2018temperate\u2019, which you require" in out[0].reason_detail

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

        assert out[0].reason_detail.endswith("is yes, and you require no")

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


UNITED_KINGDOM = "country.united_kingdom"
SWITZERLAND = "country.switzerland"
GERMANY = "country.germany"
ROMANIA = "country.romania"
IRELAND = "country.ireland"
ICELAND = "country.iceland"


def everywhere(*citizenships: str) -> tuple[ClearingCitizenship, ...]:
    return tuple(ClearingCitizenship(citizenship=held) for held in citizenships)


# The shape of 0517's and 0526's catalog rows: which citizenships clear which gate, and where.
CITIZENSHIP_GATES = {
    "uk_skilled_worker": MatchRule(
        id="uk_skilled_worker",
        name="UK Skilled Worker route",
        level="country",
        researchable=True,
        concerned_candidates=(UNITED_KINGDOM,),
        cleared_by=everywhere(IRELAND, UNITED_KINGDOM),
    ),
    "ch_eu_efta_quota": MatchRule(
        id="ch_eu_efta_quota",
        name="Swiss EU/EFTA permit quota",
        level="country",
        researchable=True,
        concerned_candidates=(SWITZERLAND,),
        cleared_by=everywhere(SWITZERLAND),
    ),
    "eu_free_movement": MatchRule(
        id="eu_free_movement",
        name="EU/EEA free movement",
        level="country",
        concerned_candidates=(GERMANY, IRELAND, ROMANIA),
        cleared_by=(
            *everywhere(IRELAND, ROMANIA),
            ClearingCitizenship(citizenship=UNITED_KINGDOM, candidates=(IRELAND,)),
        ),
        decided_by_citizenship=True,
    ),
}


def holding(candidate: str, *citizenships: str) -> Citizenship:
    return Citizenship(candidate=candidate, held=frozenset(citizenships), gates=CITIZENSHIP_GATES)


def refused_by(gate: str, candidate: str, *citizenships: str, answers=()):
    return gates_that_rule_out(
        enforced=[gate],
        answers=list(answers),
        names=Names(gates={gate: CITIZENSHIP_GATES[gate].name}, places={UNITED_KINGDOM: "UK"}),
        citizenship=holding(candidate, *citizenships),
    )


def a_refusal_of(gate: str, candidate: str) -> MatchRuleResult:
    return an_answer(gate, MatchResult.NOT_MATCHING, "no route").model_copy(
        update={"candidate": candidate, "id": 3}
    )


class TestCitizenshipDecidesTheGates:
    """Q239. Which citizenships clear which gate is catalog data, and EU free movement is
    derived from the household's citizenships with no recorded answer."""

    @pytest.mark.parametrize(
        ("gate", "candidate", "citizenship"),
        [
            ("uk_skilled_worker", UNITED_KINGDOM, UNITED_KINGDOM),
            ("uk_skilled_worker", UNITED_KINGDOM, IRELAND),
            ("ch_eu_efta_quota", SWITZERLAND, SWITZERLAND),
        ],
    )
    def test_a_citizenship_the_gate_names_clears_a_recorded_refusal(
        self, gate: str, candidate: str, citizenship: str
    ) -> None:
        assert (
            refused_by(gate, candidate, citizenship, answers=[a_refusal_of(gate, candidate)]) == ()
        )

    @pytest.mark.parametrize(
        ("gate", "candidate"),
        [("uk_skilled_worker", UNITED_KINGDOM), ("ch_eu_efta_quota", SWITZERLAND)],
    )
    def test_a_citizenship_no_gate_names_leaves_the_recorded_answer_to_decide(
        self, gate: str, candidate: str
    ) -> None:
        recorded = a_refusal_of(gate, candidate)

        (refusal,) = refused_by(gate, candidate, ICELAND, answers=[recorded])

        assert (refusal.gate_answer, refusal.citizenships) == (recorded, ())

    def test_with_no_citizenship_recorded_every_gate_reads_its_answer_alone(self) -> None:
        recorded = a_refusal_of("uk_skilled_worker", UNITED_KINGDOM)

        (refusal,) = refused_by("uk_skilled_worker", UNITED_KINGDOM, answers=[recorded])

        assert refusal.gate_answer == recorded
        assert refused_by("eu_free_movement", GERMANY) == ()

    def test_eu_free_movement_matches_an_eu_citizenship_with_no_recorded_answer(self) -> None:
        assert refused_by("eu_free_movement", GERMANY, ROMANIA) == ()

    def test_eu_free_movement_rules_out_where_no_citizenship_clears_it(self) -> None:
        (refusal,) = refused_by("eu_free_movement", GERMANY, UNITED_KINGDOM)

        assert refusal.gate_answer is None
        assert refusal.citizenships == (UNITED_KINGDOM,)
        assert refusal.reason_detail == (
            "EU/EEA free movement: no citizenship the household holds (UK) clears it"
        )

    def test_eu_free_movement_is_never_derived_about_a_country_it_does_not_concern(self) -> None:
        assert refused_by("eu_free_movement", UNITED_KINGDOM, UNITED_KINGDOM) == ()

    def test_eu_free_movement_derives_over_a_recorded_answer(self) -> None:
        """The household's citizenships decide it outright; a recorded match does not."""
        recorded = an_answer("eu_free_movement", MatchResult.MATCHING).model_copy(
            update={"candidate": GERMANY}
        )

        (refusal,) = refused_by("eu_free_movement", GERMANY, ICELAND, answers=[recorded])

        assert refusal.citizenships == (ICELAND,)

    def test_a_gate_held_as_a_warning_warns_on_the_citizenships_it_read(self) -> None:
        (warning,) = gates_that_warn(
            held_as_warnings=["eu_free_movement"],
            answers=[],
            citizenship=holding(GERMANY, UNITED_KINGDOM),
        )

        assert (str(warning.match_rule), warning.gate_answer) == ("eu_free_movement", None)
        assert warning.citizenships == (UNITED_KINGDOM,)

    def test_a_gate_switched_off_in_the_set_is_not_derived(self) -> None:
        assert (
            gates_that_rule_out(
                enforced=[], answers=[], citizenship=holding(GERMANY, UNITED_KINGDOM)
            )
            == ()
        )


class TestACitizenshipScopedToAPlace:
    """0526: a British passport clears free movement in Ireland, under the Common Travel Area,
    and nowhere else -- so a British household is not ruled out of Ireland by default."""

    def test_it_clears_the_gate_in_the_place_it_names(self) -> None:
        assert refused_by("eu_free_movement", IRELAND, UNITED_KINGDOM) == ()

    def test_it_clears_nothing_anywhere_else(self) -> None:
        (refusal,) = refused_by("eu_free_movement", GERMANY, UNITED_KINGDOM)

        assert refusal.citizenships == (UNITED_KINGDOM,)
