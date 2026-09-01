"""Application settings: four provisional numbers, none of which the code may invent.

The most important assertion in this file is the boring one -- that a fresh `Settings` has
every field unset. `reqs.md` 3.10 marks all four provisional, and a provisional number written
into a default stops being provisional the moment someone reads it there (devplan.md 0.3).
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.household import Settings


class TestWhatSettingsAccepts:
    def test_holds_the_four_tuning_values(self) -> None:
        settings = Settings(
            min_coverage=Decimal("60"),
            score_scale_max=100,
            comparator_limit=5,
            run_spend_cap_eur=Decimal("20"),
        )
        assert settings.min_coverage == 60
        assert settings.score_scale_max == 100
        assert settings.comparator_limit == 5
        assert settings.run_spend_cap_eur == 20

    @pytest.mark.parametrize("min_coverage", ["0", "100", "60.5"])
    def test_accepts_min_coverage_anywhere_on_the_percentage_scale(self, min_coverage: str) -> None:
        assert Settings(min_coverage=Decimal(min_coverage)).min_coverage == Decimal(min_coverage)

    def test_a_spend_cap_of_zero_forbids_spending_rather_than_meaning_unset(self) -> None:
        assert Settings(run_spend_cap_eur=Decimal("0")).run_spend_cap_eur == 0

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            Settings().comparator_limit = 5

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            Settings(default_currency="EUR")


class TestSettingsInventsNothing:
    @pytest.mark.parametrize(
        "field", ["min_coverage", "score_scale_max", "comparator_limit", "run_spend_cap_eur"]
    )
    def test_every_provisional_value_starts_unset(self, field: str) -> None:
        assert getattr(Settings(), field) is None

    def test_an_entirely_unset_record_is_legal(self) -> None:
        """Which is what "nobody has opened the Settings tab yet" looks like."""
        assert Settings() == Settings()

    def test_the_comparator_limit_is_not_hardcoded_to_five(self) -> None:
        """`reqs.md` 8.5 and CLAUDE.md: 5 is the default the *user* sets, not a constant."""
        assert Settings(comparator_limit=12).comparator_limit == 12


class TestTheNumbersSettingsRefuses:
    @pytest.mark.parametrize("min_coverage", ["-1", "101"])
    def test_refuses_a_coverage_floor_off_the_percentage_scale(self, min_coverage: str) -> None:
        with pytest.raises(ValidationError):
            Settings(min_coverage=Decimal(min_coverage))

    @pytest.mark.parametrize("score_scale_max", [0, -100])
    def test_refuses_a_score_scale_that_is_not_a_scale(self, score_scale_max: int) -> None:
        with pytest.raises(ValidationError):
            Settings(score_scale_max=score_scale_max)

    def test_refuses_a_comparison_that_could_hold_no_comparator(self) -> None:
        with pytest.raises(ValidationError):
            Settings(comparator_limit=0)

    def test_refuses_a_negative_spend_cap(self) -> None:
        with pytest.raises(ValidationError):
            Settings(run_spend_cap_eur=Decimal("-1"))


class TestThatThereIsExactlyOneSetOfSettings:
    def test_carries_no_identifier(self) -> None:
        assert "id" not in Settings.model_fields

    def test_cannot_be_given_one(self) -> None:
        with pytest.raises(ValidationError):
            Settings(id=2)
