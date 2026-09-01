"""What one number is worth, and the two rules the documents actually state.

The mapping from a reliability tier to a starting grade is **not** one of those rules -- it is
supplied by the caller -- so these tests state their own and check the arithmetic around it.
"""

import pytest

from starnest.data import (
    MANUAL_ENTRY_DEFAULT_CONFIDENCE,
    ConfidenceLevel,
    DataSource,
    SourceKind,
    UnknownReliabilityTierError,
    derive_confidence,
)

GRADES = {
    "official_international": ConfidenceLevel.HIGH,
    "crowdsourced": ConfidenceLevel.MEDIUM,
    "llm": ConfidenceLevel.LOW,
}

EUROSTAT = DataSource(
    id="eurostat",
    name="Eurostat",
    source_kind=SourceKind.STRUCTURED,
    default_priority=10,
    reliability_tier="official_international",
)
NUMBEO = DataSource(
    id="numbeo",
    name="Numbeo",
    source_kind=SourceKind.STRUCTURED,
    default_priority=60,
    reliability_tier="crowdsourced",
)
MANUAL = DataSource(
    id="manual",
    name="Manual entry",
    source_kind=SourceKind.MANUAL,
    default_priority=90,
    reliability_tier="manual",
)
DERIVED = DataSource(
    id="derived",
    name="Derived from other attributes",
    source_kind=SourceKind.STRUCTURED,
    default_priority=70,
    reliability_tier="derived",
)


class TestTheLadder:
    @pytest.mark.parametrize(
        ("level", "order"),
        [
            (ConfidenceLevel.ABSOLUTE, 1),
            (ConfidenceLevel.HIGH, 2),
            (ConfidenceLevel.MEDIUM, 3),
            (ConfidenceLevel.LOW, 4),
        ],
    )
    def test_sorts_the_way_the_seeded_reference_table_sorts(
        self, level: ConfidenceLevel, order: int
    ) -> None:
        """The same numbers `confidence_level.priority_order` carries, so the pure rule and
        the database view break ties identically."""
        assert level.priority_order == order

    def test_downgrading_costs_one_rung(self) -> None:
        assert ConfidenceLevel.ABSOLUTE.downgraded() is ConfidenceLevel.HIGH

    def test_downgrading_several_rungs_at_once(self) -> None:
        assert ConfidenceLevel.ABSOLUTE.downgraded(2) is ConfidenceLevel.MEDIUM

    def test_low_is_the_floor(self) -> None:
        assert ConfidenceLevel.MEDIUM.downgraded(9) is ConfidenceLevel.LOW

    def test_downgrading_by_nothing_changes_nothing(self) -> None:
        assert ConfidenceLevel.HIGH.downgraded(0) is ConfidenceLevel.HIGH

    def test_confidence_is_never_upgraded(self) -> None:
        with pytest.raises(ValueError, match="never upgraded"):
            ConfidenceLevel.LOW.downgraded(-1)


class TestDerivingAGrade:
    def test_an_official_statistic_starts_high(self) -> None:
        assert derive_confidence(EUROSTAT, grade_of_tier=GRADES) is ConfidenceLevel.HIGH

    def test_a_crowdsourced_figure_starts_medium(self) -> None:
        assert derive_confidence(NUMBEO, grade_of_tier=GRADES) is ConfidenceLevel.MEDIUM

    @pytest.mark.parametrize(
        "degradation", ["is_stale", "covers_a_coarser_geography", "is_derived"]
    )
    def test_each_way_of_being_degraded_costs_one_rung(self, degradation: str) -> None:
        assert (
            derive_confidence(EUROSTAT, grade_of_tier=GRADES, **{degradation: True})
            is ConfidenceLevel.MEDIUM
        )

    def test_degradations_accumulate(self) -> None:
        """A regional average from 2019 is worth less than either fault alone."""
        assert (
            derive_confidence(
                EUROSTAT, grade_of_tier=GRADES, is_stale=True, covers_a_coarser_geography=True
            )
            is ConfidenceLevel.LOW
        )

    def test_a_degraded_low_stays_low(self) -> None:
        assert (
            derive_confidence(
                DERIVED,
                grade_of_tier={**GRADES, "derived": ConfidenceLevel.LOW},
                is_stale=True,
                is_derived=True,
            )
            is ConfidenceLevel.LOW
        )


class TestManualEntryIsTheException:
    def test_a_typed_value_defaults_to_a_deliberately_unflattering_middle(self) -> None:
        assert derive_confidence(MANUAL, grade_of_tier=GRADES) is MANUAL_ENTRY_DEFAULT_CONFIDENCE
        assert MANUAL_ENTRY_DEFAULT_CONFIDENCE is ConfidenceLevel.MEDIUM

    def test_needs_no_grade_for_its_tier_because_a_tier_says_nothing_useful(self) -> None:
        """`manual` is not in GRADES, and a typed value is graded anyway."""
        assert derive_confidence(MANUAL, grade_of_tier={}) is ConfidenceLevel.MEDIUM

    def test_is_not_degraded_further_by_age_or_geography(self) -> None:
        assert (
            derive_confidence(MANUAL, grade_of_tier=GRADES, is_stale=True, is_derived=True)
            is ConfidenceLevel.MEDIUM
        )


class TestATierNobodyAccountedFor:
    def test_refuses_to_guess_a_grade(self) -> None:
        """Inventing one would be a plausible wrong answer, which is the failure to avoid."""
        with pytest.raises(UnknownReliabilityTierError) as raised:
            derive_confidence(DERIVED, grade_of_tier=GRADES)
        assert "derived" in str(raised.value)
