"""The gates and the multi-input rules: what they may say, and what they refuse to say.

Every catalog row here arrives from a migration, so the interesting tests are the refusals:
the shape given the wrong kind of child, the override recorded half way, the bound a shape has
no meaning for. The database refuses each of them too, and that duplication is deliberate --
a constraint name from a driver is not an explanation.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleDeclarationError,
    CompoundRuleInput,
    CompoundRuleShape,
    MalformedMatchRuleResultError,
    MatchResult,
    MatchRule,
    MatchRuleResult,
    ReferencePeriod,
    RuleOutcome,
)

CHECKED = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)
OVERRIDDEN = datetime(2026, 8, 2, 11, 0, tzinfo=UTC)


def an_answer(**overrides: object) -> MatchRuleResult:
    fields: dict[str, object] = {
        "match_rule": "uk_skilled_worker",
        "candidate": "country.united_kingdom",
        "match_result": MatchResult.MATCHING,
        "data_source": "manual",
        "retrieval_date": CHECKED,
    }
    return MatchRuleResult(**(fields | overrides))


def a_conjunction(**overrides: object) -> CompoundRule:
    fields: dict[str, object] = {
        "id": "mild_now_brutal_later",
        "name": "Mild now, brutal later",
        "level": "country",
        "shape": CompoundRuleShape.ALL_CONDITIONS_HOLD,
        "outcome": RuleOutcome.WARNING,
        "conditions": (
            CompoundRuleCondition(ordinal=1, attribute="country.avg_annual_temperature"),
            CompoundRuleCondition(ordinal=2, attribute="country.projected_summer_heat_days"),
        ),
    }
    return CompoundRule(**(fields | overrides))


def a_share_rule(**overrides: object) -> CompoundRule:
    fields: dict[str, object] = {
        "id": "rent_eats_the_budget",
        "name": "Rent eats the budget",
        "level": "country",
        "shape": CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD,
        "outcome": RuleOutcome.WARNING,
        "threshold_max": Decimal("0.45"),
        "inputs": (
            CompoundRuleInput(input_order=1, attribute="country.rent_centre"),
            CompoundRuleInput(input_order=2, household_field="target_monthly_spend"),
        ),
    }
    return CompoundRule(**(fields | overrides))


class TestTheMatchVocabulary:
    def test_a_gate_answers_matching_not_matching_or_unknown(self) -> None:
        assert [result.value for result in MatchResult] == [
            "matching",
            "not_matching",
            "unknown",
        ]

    def test_an_unresearched_gate_is_unknown_and_never_insufficient_data(self) -> None:
        """The evaluation's third state answers a different question and is not in this enum.

        `unknown` is a gate nobody has looked at; `insufficient_data` is a candidate too
        sparsely measured to score. Merging them would make each state unsayable.
        """
        assert "insufficient_data" not in {result.value for result in MatchResult}
        assert MatchResult("unknown") is MatchResult.UNKNOWN

    def test_a_word_from_no_vocabulary_at_all_is_refused(self) -> None:
        with pytest.raises(ValueError, match="eliminated"):
            MatchResult("eliminated")

    def test_a_rule_firing_either_warns_or_says_not_matching(self) -> None:
        """`not_matching` is the same word a gate uses -- there is one vocabulary."""
        assert [outcome.value for outcome in RuleOutcome] == ["warning", "not_matching"]


class TestAGate:
    def test_holds_an_identifier_a_name_and_the_level_it_is_asked_at(self) -> None:
        rule = MatchRule(id="uk_skilled_worker", name="UK Skilled Worker route", level="country")
        assert (rule.id, rule.level) == ("uk_skilled_worker", "country")

    def test_with_no_level_is_asked_at_every_level(self) -> None:
        """A candidate excluded by hand is excluded whichever level it sits at."""
        everywhere = MatchRule(id="not_manually_excluded", name="Not manually excluded")
        assert everywhere.applies_at("country")
        assert everywhere.applies_at("city")

    def test_with_a_level_is_asked_only_there(self) -> None:
        country_only = MatchRule(id="ch_eu_efta_quota", name="Swiss quota", level="country")
        assert country_only.applies_at("country")
        assert not country_only.applies_at("city")

    def test_carries_no_opinion_about_whether_it_is_enforced(self) -> None:
        """Enforcement is a preference and lives in a criteria set (`reqs.md` 3.7)."""
        assert "is_enforced" not in MatchRule.model_fields

    def test_refuses_a_name_that_says_nothing(self) -> None:
        with pytest.raises(ValidationError):
            MatchRule(id="uk_skilled_worker", name="")

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            MatchRule(id="uk_skilled_worker", name="UK").name = "Something else"


class TestAGatesAnswer:
    def test_holds_the_verdict_its_source_and_when_it_was_checked(self) -> None:
        answer = an_answer(reason="Citizenship confers no automatic right")
        assert answer.match_result is MatchResult.MATCHING
        assert (answer.data_source, answer.retrieval_date) == ("manual", CHECKED)
        assert answer.reason == "Citizenship confers no automatic right"

    def test_holds_the_period_the_judgement_is_good_for_beside_the_day_it_was_read(self) -> None:
        """Two dates, never merged: an annual quota is an annual fact (`reqs.md` 3.7)."""
        answer = an_answer(reference_period=ReferencePeriod.covering_year(2026))
        assert answer.reference_period is not None
        assert answer.reference_period.covers(datetime(2026, 6, 1).date())
        assert answer.retrieval_date == CHECKED

    def test_may_hold_no_period_at_all(self) -> None:
        """Nobody recorded one -- an answer with no expiry, not one that never expires."""
        assert an_answer().reference_period is None

    def test_shows_the_pages_it_was_read_from(self) -> None:
        pages = ("https://gov.uk/skilled-worker-visa",)
        assert an_answer(citations=pages).citations == pages

    def test_is_not_overridden_until_somebody_overrides_it(self) -> None:
        assert not an_answer().is_overridden

    def test_records_an_override_as_a_reason_and_the_moment_it_was_given(self) -> None:
        overridden = an_answer(
            match_result=MatchResult.NOT_MATCHING,
            override_reason="Ruled out by hand",
            override_date=OVERRIDDEN,
        )
        assert overridden.is_overridden
        assert overridden.override_date == OVERRIDDEN


class TestWhatAGatesAnswerRefuses:
    def test_refuses_an_override_with_a_reason_and_no_date(self) -> None:
        """An unattributed exclusion. The schema's all-or-nothing CHECK, said in words."""
        with pytest.raises(ValidationError) as raised:
            an_answer(override_reason="Ruled out by hand")
        error = raised.value.errors()[0]["ctx"]["error"]
        assert isinstance(error, MalformedMatchRuleResultError)
        assert "the date it was given" in str(error)

    def test_refuses_an_override_with_a_date_and_no_reason(self) -> None:
        """A marker nobody can explain, which is the same fault from the other side."""
        with pytest.raises(ValidationError) as raised:
            an_answer(override_date=OVERRIDDEN)
        assert "the reason it was given for" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_a_retrieval_date_with_no_timezone(self) -> None:
        with pytest.raises(ValidationError) as raised:
            an_answer(retrieval_date=datetime(2026, 8, 1))
        assert "retrieval_date" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_an_override_date_with_no_timezone(self) -> None:
        with pytest.raises(ValidationError) as raised:
            an_answer(override_reason="Ruled out", override_date=datetime(2026, 8, 2))
        assert "override_date" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_a_verdict_from_outside_the_vocabulary(self) -> None:
        with pytest.raises(ValidationError):
            an_answer(match_result="eliminated")

    def test_refuses_a_candidate_identifier_that_is_not_one(self) -> None:
        with pytest.raises(ValidationError):
            an_answer(candidate="portugal")

    def test_refuses_a_field_nobody_declared(self) -> None:
        with pytest.raises(ValidationError):
            an_answer(is_enforced=True)


class TestAShapeIsANameAndNothingElse:
    def test_names_the_three_comparisons_the_schema_knows(self) -> None:
        assert {shape.value for shape in CompoundRuleShape} == {
            "ShareOfHouseholdField",
            "SumBelowFloor",
            "AllConditionsHold",
        }

    def test_performs_none_of_them(self) -> None:
        """The implementations belong to `evaluation/` (`devplan.md` W2-A).

        A shape that could compare would be a shape this module had to keep in step with the
        arithmetic, and `data/` cannot see the arithmetic.
        """
        assert not [
            name for name in vars(CompoundRuleShape) if name in ("evaluate", "fires", "compare")
        ]

    def test_refuses_a_shape_nobody_implemented(self) -> None:
        with pytest.raises(ValueError, match="RatioBetweenAttributes"):
            CompoundRuleShape("RatioBetweenAttributes")


class TestOneInputOfARule:
    def test_names_an_attribute(self) -> None:
        an_input = CompoundRuleInput(input_order=1, attribute="country.rent_centre")
        assert an_input.attribute == "country.rent_centre"
        assert an_input.household_field is None

    def test_names_a_household_field(self) -> None:
        an_input = CompoundRuleInput(input_order=2, household_field="target_monthly_spend")
        assert an_input.household_field == "target_monthly_spend"

    def test_carries_no_bound_of_its_own(self) -> None:
        """The shapes taking inputs compare what the inputs produce together, not one input."""
        assert "threshold_min" not in CompoundRuleInput.model_fields
        assert "threshold_max" not in CompoundRuleInput.model_fields

    def test_refuses_an_input_that_names_nothing(self) -> None:
        with pytest.raises(ValidationError) as raised:
            CompoundRuleInput(input_order=1)
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], CompoundRuleDeclarationError)

    def test_refuses_an_input_that_names_both(self) -> None:
        """Which of the two the shape read would depend on which column somebody looked at."""
        with pytest.raises(ValidationError):
            CompoundRuleInput(
                input_order=1,
                attribute="country.rent_centre",
                household_field="target_monthly_spend",
            )

    def test_refuses_a_position_that_is_not_one(self) -> None:
        with pytest.raises(ValidationError):
            CompoundRuleInput(input_order=0, attribute="country.rent_centre")


class TestOneConditionOfAConjunction:
    def test_bounds_one_attribute_in_that_attributes_own_unit(self) -> None:
        condition = CompoundRuleCondition(
            ordinal=1,
            attribute="country.avg_annual_temperature",
            threshold_min=Decimal("12"),
            threshold_max=Decimal("18"),
        )
        assert condition.attribute == "country.avg_annual_temperature"
        assert condition.is_decided

    def test_is_decided_by_a_bound_at_either_end_alone(self) -> None:
        below = CompoundRuleCondition(ordinal=1, attribute="country.x", threshold_max=Decimal("3"))
        above = CompoundRuleCondition(ordinal=1, attribute="country.x", threshold_min=Decimal("3"))
        assert below.is_decided
        assert above.is_decided

    def test_with_no_bound_at_all_is_legal_and_undecided(self) -> None:
        """What ships: every threshold in `reqs.md` 7.4 is TBD, and none was invented."""
        undecided = CompoundRuleCondition(ordinal=1, attribute="country.avg_annual_temperature")
        assert undecided.threshold_min is None
        assert undecided.threshold_max is None
        assert not undecided.is_decided

    def test_refuses_a_band_that_runs_backwards(self) -> None:
        with pytest.raises(ValidationError) as raised:
            CompoundRuleCondition(
                ordinal=1,
                attribute="country.x",
                threshold_min=Decimal("18"),
                threshold_max=Decimal("12"),
            )
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], CompoundRuleDeclarationError)

    def test_refuses_an_ordinal_that_is_not_a_position(self) -> None:
        with pytest.raises(ValidationError):
            CompoundRuleCondition(ordinal=0, attribute="country.x")


class TestWhatARuleCarries:
    def test_a_conjunction_carries_conditions_and_no_rule_level_bound(self) -> None:
        rule = a_conjunction()
        assert len(rule.conditions) == 2
        assert rule.inputs == ()
        assert (rule.threshold_min, rule.threshold_max) == (None, None)

    def test_a_share_rule_carries_inputs_and_a_ceiling(self) -> None:
        rule = a_share_rule()
        assert [an_input.input_order for an_input in rule.inputs] == [1, 2]
        assert rule.conditions == ()
        assert rule.threshold_max == Decimal("0.45")

    def test_a_sum_rule_carries_a_floor(self) -> None:
        rule = CompoundRule(
            id="two_role_feasibility",
            name="Two-role feasibility",
            shape=CompoundRuleShape.SUM_BELOW_FLOOR,
            outcome=RuleOutcome.NOT_MATCHING,
            threshold_min=Decimal("400"),
            inputs=(CompoundRuleInput(input_order=1, attribute="country.tech_software_jobs"),),
        )
        assert rule.threshold_min == Decimal("400")
        assert rule.outcome is RuleOutcome.NOT_MATCHING

    def test_with_no_level_applies_at_every_level(self) -> None:
        assert a_share_rule(level=None).applies_at("city")

    def test_with_a_level_applies_only_there(self) -> None:
        assert not a_share_rule().applies_at("city")

    def test_carries_no_opinion_about_whether_it_is_applied(self) -> None:
        """Which rules a set applies is a preference, held beside the set (`reqs.md` 3.7a)."""
        assert "is_applied" not in CompoundRule.model_fields

    def test_carries_no_operator_or_connective(self) -> None:
        """AND is implicit in the shape's name; a column for it would be a grammar."""
        assert not [
            name for name in CompoundRule.model_fields if name in ("operator", "connective")
        ]

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            a_conjunction().outcome = RuleOutcome.NOT_MATCHING


class TestARuleCarriesOneKindOfChild:
    def test_refuses_a_conjunction_given_inputs(self) -> None:
        """The composite key `(id, shape)` in Python: inputs belong to the other two shapes."""
        with pytest.raises(ValidationError) as raised:
            a_conjunction(
                inputs=(CompoundRuleInput(input_order=1, attribute="country.rent_centre"),)
            )
        error = raised.value.errors()[0]["ctx"]["error"]
        assert isinstance(error, CompoundRuleDeclarationError)
        assert "reads conditions" in str(error)

    @pytest.mark.parametrize(
        "shape", [CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD, CompoundRuleShape.SUM_BELOW_FLOOR]
    )
    def test_refuses_a_list_reading_shape_given_conditions(self, shape: CompoundRuleShape) -> None:
        with pytest.raises(ValidationError) as raised:
            a_share_rule(
                shape=shape,
                threshold_max=None,
                conditions=(CompoundRuleCondition(ordinal=1, attribute="country.x"),),
            )
        assert "reads inputs" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_two_inputs_in_one_position(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_share_rule(
                inputs=(
                    CompoundRuleInput(input_order=1, attribute="country.rent_centre"),
                    CompoundRuleInput(input_order=1, household_field="target_monthly_spend"),
                )
            )
        assert "share a position" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_two_conditions_with_one_ordinal(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_conjunction(
                conditions=(
                    CompoundRuleCondition(ordinal=1, attribute="country.a"),
                    CompoundRuleCondition(ordinal=1, attribute="country.b"),
                )
            )
        assert "share an ordinal" in str(raised.value.errors()[0]["ctx"]["error"])

    def test_refuses_bounding_one_attribute_twice(self) -> None:
        """Two bounds on one attribute are one narrower band, so a second is a mistake."""
        with pytest.raises(ValidationError) as raised:
            a_conjunction(
                conditions=(
                    CompoundRuleCondition(
                        ordinal=1, attribute="country.a", threshold_min=Decimal("1")
                    ),
                    CompoundRuleCondition(
                        ordinal=2, attribute="country.a", threshold_max=Decimal("9")
                    ),
                )
            )
        assert "bounds one attribute twice" in str(raised.value.errors()[0]["ctx"]["error"])


class TestARuleCarriesOnlyTheBoundItsShapeReads:
    def test_refuses_a_floor_on_a_share_rule(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_share_rule(threshold_min=Decimal("0.1"))
        error = raised.value.errors()[0]["ctx"]["error"]
        assert isinstance(error, CompoundRuleDeclarationError)
        assert "the bound it reads is threshold_max" in str(error)

    def test_refuses_a_ceiling_on_a_sum_rule(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_share_rule(shape=CompoundRuleShape.SUM_BELOW_FLOOR, threshold_max=Decimal("0.45"))
        assert "the bound it reads is threshold_min" in str(
            raised.value.errors()[0]["ctx"]["error"]
        )

    @pytest.mark.parametrize("bound", ["threshold_min", "threshold_max"])
    def test_refuses_either_rule_level_bound_on_a_conjunction(self, bound: str) -> None:
        """Every number it compares is in one attribute's own unit, so it takes none here."""
        with pytest.raises(ValidationError) as raised:
            a_conjunction(**{bound: Decimal("3")})
        assert "reads its bounds from its conditions" in str(
            raised.value.errors()[0]["ctx"]["error"]
        )


class TestWhetherARuleHasBeenDecided:
    def test_the_shipped_conjunctions_are_undecided_and_that_is_intended(self) -> None:
        """Every threshold in `reqs.md` 7.4 is TBD, so both shipped rules cannot fire."""
        assert not a_conjunction().is_decided

    def test_a_conjunction_is_decided_only_when_every_condition_is(self) -> None:
        half = a_conjunction(
            conditions=(
                CompoundRuleCondition(
                    ordinal=1, attribute="country.a", threshold_max=Decimal("18")
                ),
                CompoundRuleCondition(ordinal=2, attribute="country.b"),
            )
        )
        whole = a_conjunction(
            conditions=(
                CompoundRuleCondition(
                    ordinal=1, attribute="country.a", threshold_max=Decimal("18")
                ),
                CompoundRuleCondition(
                    ordinal=2, attribute="country.b", threshold_min=Decimal("30")
                ),
            )
        )
        assert not half.is_decided
        assert whole.is_decided

    def test_a_conjunction_over_no_conditions_is_undecided_rather_than_vacuously_true(
        self,
    ) -> None:
        """An empty conjunction holds for everything, which would flag every candidate."""
        assert not a_conjunction(conditions=()).is_decided

    def test_a_share_rule_is_decided_when_it_has_its_ceiling_and_its_inputs(self) -> None:
        assert a_share_rule().is_decided

    def test_a_share_rule_missing_its_ceiling_is_undecided(self) -> None:
        assert not a_share_rule(threshold_max=None).is_decided

    def test_a_rule_reading_no_inputs_is_undecided_however_bounded(self) -> None:
        assert not a_share_rule(inputs=()).is_decided
