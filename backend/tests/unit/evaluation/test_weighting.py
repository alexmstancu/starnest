"""Redistribution and coverage: the two answers a missing figure needs (`reqs.md` 5.3).

They look like one question and are not. Redistribution decides what the criteria we *do* have
should count for; coverage says how much of what was asked for was found. Redistribution is what
makes a sparse candidate scoreable at all, and coverage is what stops that being mistaken for a
well-evidenced one -- so a test file that proves one without the other proves nothing.
"""

from decimal import Decimal

import pytest

from starnest.evaluation import WeightingError, coverage_of, redistribute


def weights(**named: str) -> dict[str, Decimal]:
    return {attribute: Decimal(weight) for attribute, weight in named.items()}


ALL_THREE = weights(rent="50", jobs="30", safety="20")


class TestCoverageMeasuresWhatWasFound:
    def test_everything_answered_is_full_coverage(self) -> None:
        assert coverage_of(ALL_THREE, {"rent", "jobs", "safety"}) == Decimal(100)

    def test_nothing_answered_is_no_coverage(self) -> None:
        """A candidate nobody has fetched anything for. Not an error -- the ordinary opening
        state of every candidate in the catalog."""
        assert coverage_of(ALL_THREE, set()) == Decimal(0)

    def test_coverage_is_weighted_by_importance_and_not_counted_by_criteria(self) -> None:
        """The case that decides whether coverage means anything.

        Two of three criteria answered is 67% if you count rows. Weighted, the same pair is
        50% -- and the difference is the criterion the user said mattered most. Counting rows
        would report a well-evidenced candidate where the important thing was never found.
        """
        assert coverage_of(ALL_THREE, {"jobs", "safety"}) == Decimal(50)

    def test_answering_only_the_heaviest_criterion_is_already_half_the_coverage(self) -> None:
        assert coverage_of(ALL_THREE, {"rent"}) == Decimal(50)

    def test_an_answer_to_a_criterion_the_set_does_not_hold_is_ignored(self) -> None:
        """A value for an attribute nobody weighted contributes nothing and inflates nothing."""
        assert coverage_of(ALL_THREE, {"rent", "climate"}) == Decimal(50)


class TestRedistributionSpreadsTheMissingWeight:
    def test_everything_answered_leaves_every_weight_alone(self) -> None:
        assert redistribute(ALL_THREE, {"rent", "jobs", "safety"}) == ALL_THREE

    def test_the_answered_weights_always_sum_to_the_whole(self) -> None:
        """Why a sparse candidate is comparable with a complete one at all: both are scored out
        of the same 100, and coverage is what distinguishes them."""
        scored = redistribute(ALL_THREE, {"jobs", "safety"})
        assert sum(scored.values()) == Decimal(100)

    def test_relative_importance_survives_redistribution(self) -> None:
        """`jobs` was worth half again what `safety` was, and still is.

        Proportional rather than equal shares: spreading the missing weight evenly would
        quietly re-rank the user's own preferences every time a source failed.
        """
        scored = redistribute(ALL_THREE, {"jobs", "safety"})
        assert scored["jobs"] / scored["safety"] == Decimal(30) / Decimal(20)

    def test_an_unanswered_criterion_comes_back_at_zero_rather_than_missing(self) -> None:
        """The drill-down still has a row to show for it (`reqs.md` 5.3)."""
        scored = redistribute(ALL_THREE, {"jobs", "safety"})
        assert scored["rent"] == Decimal(0)
        assert set(scored) == set(ALL_THREE)

    def test_one_answered_criterion_carries_the_whole_weight(self) -> None:
        assert redistribute(ALL_THREE, {"safety"})["safety"] == Decimal(100)

    def test_nothing_answered_gives_every_criterion_nothing(self) -> None:
        """Not an error, and not a score of zero either: the caller reads an all-zero
        redistribution as insufficient data, which is a different thing to display."""
        assert redistribute(ALL_THREE, set()) == dict.fromkeys(ALL_THREE, Decimal(0))


class TestWeightsThatCannotBeUsed:
    def test_an_empty_criteria_set_is_refused_by_coverage(self) -> None:
        """A percentage of nothing is not zero; it is a question that does not apply."""
        with pytest.raises(WeightingError, match="coverage of nothing"):
            coverage_of({}, set())

    def test_an_empty_criteria_set_is_refused_by_redistribution(self) -> None:
        with pytest.raises(WeightingError, match="no criteria to weigh"):
            redistribute({}, set())

    def test_criteria_carrying_no_weight_between_them_are_refused(self) -> None:
        """Every criterion excluded, or every weight dragged to zero. There is no share for
        anything to hold, and dividing by it would produce a total nobody could explain."""
        with pytest.raises(WeightingError, match="carry no weight"):
            redistribute(weights(rent="0", jobs="0"), {"rent"})


def test_a_subset_of_a_set_is_scored_against_its_own_total() -> None:
    """One pillar's criteria weighed on their own sum to 100 within that pillar.

    The total is read from the weights rather than assumed, because rebalancing passes through
    intermediate states and a caller scoring one pillar has a legitimate total of its own.
    """
    one_pillar = weights(rent="60", mortgage="40")

    assert coverage_of(one_pillar, {"rent"}) == Decimal(60)
    assert redistribute(one_pillar, {"rent"})["rent"] == Decimal(100)
