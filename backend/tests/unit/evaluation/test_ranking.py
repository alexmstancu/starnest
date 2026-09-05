"""One criteria set run against the candidates at one level (`reqs.md` 5).

Everything the arithmetic modules prove separately, assembled -- and the assembly is where the
rules that matter most to the product live: a sparse candidate is scored rather than punished, a
candidate that cannot be scored says so rather than showing a zero, and nothing is filtered out
of the result whatever its status.

**The scale here is 10, not 100**, so a hardcoded ceiling cannot pass unnoticed.

**Two criteria means two pillars.** `CriteriaSet` refuses a pillar whose criteria do not sum to
100, so a set that splits weight has to split it between pillars -- which is the two-level
weighting doing what it is for, rather than a shape invented for these tests.
"""

from decimal import Decimal

import pytest

from starnest.criteria import Goal
from starnest.data import Count
from starnest.evaluation import MatchStatus, RankingError, rank_candidates

from .builders import (
    A_SMALL_SCALE,
    RENT,
    a_criterion,
    a_pillar_weight,
    a_set,
    a_value,
    two_pillars,
    values_for,
)

HOUSING = "housing"


def rank(criteria, values, *, scale: int = A_SMALL_SCALE, min_coverage=None):
    return rank_candidates(
        criteria=criteria,
        level="country",
        values=values,
        score_scale_max=scale,
        min_coverage=min_coverage,
    )


def by_candidate(results):
    return {str(result.candidate): result for result in results}


def three_countries_one_missing_its_rent():
    """Portugal and Italy answer both criteria; Spain answers only the first.

    Three rather than two because `percentile` needs at least two figures in a column to have a
    standing to report, and Spain's absence from the rent column must not empty it.
    """
    values = values_for(portugal=90, spain=10, italy=50)
    for candidate, rent in (("country.portugal", 5), ("country.italy", 9)):
        values[candidate] = (
            *values[candidate],
            a_value(candidate=candidate, attribute=RENT, payload=Count(count=rent)),
        )
    return values


class TestScoringAndOrdering:
    def test_the_better_candidate_scores_higher_and_ranks_first(self) -> None:
        results = rank(a_set([a_criterion()]), values_for(portugal=90, spain=10))

        found = by_candidate(results)
        assert found["country.portugal"].score == A_SMALL_SCALE
        assert found["country.spain"].score == 0
        assert found["country.portugal"].rank == 1
        assert found["country.spain"].rank == 2

    def test_minimising_puts_the_smaller_figure_first(self) -> None:
        """The same figures read as a cost rather than an opportunity."""
        results = rank(a_set([a_criterion(goal=Goal.MINIMISE)]), values_for(portugal=90, spain=10))

        assert by_candidate(results)["country.spain"].rank == 1

    def test_equal_scores_share_a_rank_and_the_next_one_skips(self) -> None:
        """Breaking a tie on the identifier would put one country above another for
        alphabetical reasons and present it as a finding."""
        results = rank(a_set([a_criterion()]), values_for(portugal=50, spain=50, italy=10))

        found = by_candidate(results)
        assert found["country.portugal"].rank == found["country.spain"].rank == 1
        assert found["country.italy"].rank == 3

    def test_scores_follow_the_configured_scale_rather_than_a_hundred(self) -> None:
        results = rank(a_set([a_criterion()]), values_for(portugal=90, spain=10), scale=100)

        assert by_candidate(results)["country.portugal"].score == 100

    def test_every_candidate_comes_back_whatever_its_status(self) -> None:
        """Unscoreable candidates stay visible (`reqs.md` 5.4). Filtering here would make the
        reason a candidate is out impossible to show downstream."""
        results = rank(a_set([a_criterion()]), {"country.portugal": (), "country.spain": ()})

        assert len(results) == 2
        assert all(result.match_status is MatchStatus.INSUFFICIENT_DATA for result in results)


class TestASparseCandidateIsScoredRatherThanPunished:
    def test_a_missing_criterion_redistributes_its_weight(self) -> None:
        """The heart of `reqs.md` 5.3. Spain answers one criterion of two and is still scored
        out of the same whole, with coverage carrying the difference."""
        found = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))

        assert found["country.spain"].coverage == Decimal(50)
        assert found["country.portugal"].coverage == Decimal(100)
        assert found["country.spain"].score is not None
        assert found["country.spain"].match_status is MatchStatus.MATCHING

    def test_the_breakdown_shows_the_weight_actually_used(self) -> None:
        """Showing the stored weight would make the arithmetic fail to add up on screen."""
        spain = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))[
            "country.spain"
        ]

        answered = [row for row in spain.attribute_scores if row.normalised_score is not None]
        unanswered = [row for row in spain.attribute_scores if row.normalised_score is None]
        assert [row.effective_weight for row in answered] == [Decimal(100)]
        assert [row.effective_weight for row in unanswered] == [Decimal(0)]

    def test_the_contributions_add_up_to_the_total(self) -> None:
        """A total nobody can take apart is a number this application may not show."""
        portugal = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))[
            "country.portugal"
        ]

        parts = sum((row.contribution for row in portugal.attribute_scores), Decimal(0))
        assert round(parts) == portugal.score

    def test_a_rejected_value_counts_as_no_value(self) -> None:
        """From the point of view of a score there is no difference between a figure nobody
        found and one that could not be read."""
        values = values_for(portugal=90, spain=10)
        values["country.spain"] = (
            a_value(candidate="country.spain", payload=None, rejection_reason="a negative count"),
        )

        found = by_candidate(rank(a_set([a_criterion()]), values))

        assert found["country.spain"].coverage == Decimal(0)
        assert found["country.spain"].score is None


class TestWhenACandidateCannotBeScored:
    def test_nothing_found_at_all_is_insufficient_data_and_never_a_zero(self) -> None:
        """A zero is a claim that everything measured badly.

        It is the fabrication `reqs.md` forbids and the one a reader is least likely to
        question, because it looks like a score.
        """
        spain = by_candidate(rank(a_set([a_criterion()]), {"country.spain": ()}))["country.spain"]

        assert spain.score is None
        assert spain.coverage == Decimal(0)
        assert spain.match_status is MatchStatus.INSUFFICIENT_DATA
        assert spain.rank is None
        assert "no figure" in (spain.insufficient_reason or "")

    def test_a_missing_blocking_criterion_makes_it_insufficient_data(self) -> None:
        """Even with everything else answered. The user declared it unscoreable without this."""
        criteria = two_pillars(blocks_if_missing=True)
        values = {
            candidate: (a_value(candidate=candidate, attribute=RENT, payload=Count(count=n)),)
            for candidate, n in (("country.portugal", 5), ("country.italy", 9))
        }

        found = by_candidate(rank(criteria, values))

        assert found["country.portugal"].match_status is MatchStatus.INSUFFICIENT_DATA
        assert found["country.portugal"].coverage == Decimal(50)

    def test_the_reason_names_the_criterion_that_was_missing(self) -> None:
        """A screen has to say why, and "insufficient data" on its own says nothing."""
        criteria = a_set([a_criterion(blocks_if_missing=True)])

        spain = by_candidate(rank(criteria, {"country.spain": ()}))["country.spain"]

        assert a_criterion().attribute in (spain.insufficient_reason or "")

    def test_coverage_below_the_floor_makes_it_insufficient_data(self) -> None:
        found = by_candidate(
            rank(two_pillars(), three_countries_one_missing_its_rent(), min_coverage=Decimal(60))
        )

        assert found["country.spain"].match_status is MatchStatus.INSUFFICIENT_DATA
        assert "60%" in (found["country.spain"].insufficient_reason or "")
        assert found["country.portugal"].match_status is MatchStatus.MATCHING

    def test_no_floor_means_any_coverage_that_found_something_is_scored(self) -> None:
        """`settings.min_coverage` is nullable and unseeded, so this is the shipped state."""
        found = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))

        assert found["country.spain"].match_status is MatchStatus.MATCHING


class TestTheTwoLevelWeighting:
    def test_a_pillar_weight_changes_what_its_criteria_contribute(self) -> None:
        """A criterion's real share is its weight within its pillar times its pillar's within
        the level (`reqs.md` 7). A ranking that used only the inner weight would score two very
        differently-weighted pillars identically."""
        values = values_for(portugal=90, spain=10)
        # Portugal has the WORSE figure in the second pillar, so it wins the pillar worth 80
        # and loses the one worth 20. Winning both would prove nothing about the weighting.
        for candidate, rent in (("country.portugal", 1), ("country.spain", 9)):
            values[candidate] = (
                *values[candidate],
                a_value(candidate=candidate, attribute=RENT, payload=Count(count=rent)),
            )

        found = by_candidate(rank(two_pillars(first="80", second="20"), values))

        # Portugal wins the pillar worth 80 and loses the one worth 20.
        assert found["country.portugal"].score == 8
        assert found["country.spain"].score == 2

    def test_a_criterion_in_an_unweighted_pillar_never_reaches_the_ranking(self) -> None:
        """Refused a layer earlier, by `CriteriaSet` itself.

        Worth a test here anyway: it is why `_level_wide_weights` does not re-check, and if that
        guarantee ever moved, this is what would notice.
        """
        with pytest.raises(ValueError, match="carries no weight"):
            a_set(
                [a_criterion(), a_criterion(attribute=RENT, pillar=HOUSING)],
                [a_pillar_weight(weight="100")],
            )


class TestExcludingACriterionIsNotMissingOne:
    def test_an_excluded_criterion_takes_no_weight_and_leaves_no_gap(self) -> None:
        """`is_scored = false` is a decision that it does not apply, so coverage is unaffected
        (`reqs.md` 5.3). A candidate with no figure for it is still fully covered."""
        criteria = a_set(
            [
                a_criterion(weight=Decimal("100")),
                a_criterion(attribute=RENT, pillar=HOUSING, weight=Decimal("100"), is_scored=False),
            ],
            [a_pillar_weight(weight="50"), a_pillar_weight(pillar=HOUSING, weight="50")],
        )

        found = by_candidate(rank(criteria, values_for(portugal=90, spain=10)))

        assert found["country.spain"].coverage == Decimal(100)
        assert [row.attribute for row in found["country.spain"].attribute_scores] == [
            a_criterion().attribute
        ]


class TestWhenThereIsNoRankingToProduce:
    def test_a_set_that_scores_nothing_at_this_level_is_refused(self) -> None:
        criteria = a_set([a_criterion(is_scored=False)])

        with pytest.raises(RankingError, match="scores nothing at level"):
            rank(criteria, values_for(portugal=90, spain=10))

    def test_a_criterion_whose_column_cannot_be_normalised_costs_coverage(self) -> None:
        """One candidate under percentile has no standing to score. The criterion contributes
        nothing to anybody rather than failing the ranking, and coverage says so."""
        found = by_candidate(rank(a_set([a_criterion()]), values_for(portugal=90)))

        assert found["country.portugal"].coverage == Decimal(0)
        assert found["country.portugal"].score is None


def test_a_value_for_an_attribute_this_set_does_not_score_is_ignored() -> None:
    """Values are fetched per attribute, criteria sets are chosen per person.

    So a candidate routinely holds figures the active set has no opinion about -- a set built
    for remote work carries no view on schooling, and the schooling figures are still stored.
    They must contribute nothing and, above all, inflate nothing: counting one toward coverage
    would report evidence for a criterion nobody is scoring.
    """
    values = values_for(portugal=90, spain=10)
    values["country.spain"] = (
        *values["country.spain"],
        a_value(candidate="country.spain", attribute=RENT, payload=Count(count=5)),
    )

    found = by_candidate(rank(a_set([a_criterion()]), values))

    assert found["country.spain"].coverage == Decimal(100)
    assert [row.attribute for row in found["country.spain"].attribute_scores] == [
        a_criterion().attribute
    ]
