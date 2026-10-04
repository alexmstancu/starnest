"""The pillar rollup, and the difference against home.

Both exist so the ranking can show a score's *shape* -- which of the eleven verticals carried
it, and how it stands against staying put -- without asking for the 43-row attribute breakdown.
"""

from decimal import Decimal

import pytest

from starnest.data import AttributeId, PillarId
from starnest.evaluation.ranking import delta_against, pillars_of, rank_candidates
from starnest.evaluation.results import AttributeScore

from .builders import A_SMALL_SCALE, a_criterion, a_set, values_for

HOME = "country.portugal"


def a_row(
    pillar: str,
    *,
    attribute: str = "country.thing",
    score: int | None = 80,
    weight: str = "10",
    contribution: str | None = None,
) -> AttributeScore:
    """One criterion's part, with the contribution consistent with the score unless told."""
    effective = Decimal(weight)
    put_in = (
        Decimal(contribution)
        if contribution is not None
        else (Decimal(score) * effective / 100 if score is not None else Decimal(0))
    )
    return AttributeScore(
        attribute=AttributeId(attribute),
        pillar=PillarId(pillar),
        normalised_score=score,
        effective_weight=effective,
        contribution=put_in,
    )


class TestTheRollup:
    def test_it_sums_the_weights_and_contributions_of_a_pillar(self) -> None:
        rolled = pillars_of(
            [a_row("economics", weight="10"), a_row("economics", weight="4", score=50)]
        )

        (economics,) = rolled
        assert economics.weight == Decimal(14)
        assert economics.contribution == Decimal(10)  # 8.0 + 2.0

    def test_a_pillar_score_is_the_weighted_mean_of_what_scored_in_it(self) -> None:
        """Read back out of the contribution, so the arithmetic on screen reconciles."""
        rolled = pillars_of(
            [a_row("economics", weight="10", score=80), a_row("economics", weight="10", score=60)]
        )

        assert rolled[0].score == 70

    def test_the_contributions_still_sum_to_the_total(self) -> None:
        """**The property that matters.** A rollup that did its own arithmetic could put eleven
        numbers on screen that do not add up to the score beside them."""
        rows = [
            a_row("economics", weight="14", score=78),
            a_row("housing", weight="10", score=80),
            a_row("career", weight="14", score=84),
        ]

        assert sum(p.contribution for p in pillars_of(rows)) == sum(r.contribution for r in rows)

    def test_a_pillar_where_nothing_scored_keeps_its_weight_and_gets_no_score(self) -> None:
        """Zero would read as "measured, and badly"; absent would hide that a whole vertical of
        the decision has nothing behind it."""
        rolled = pillars_of([a_row("family", score=None, weight="4")])

        (family,) = rolled
        assert family.score is None
        assert family.weight == Decimal(4)
        assert family.contribution == Decimal(0)

    def test_one_scored_criterion_is_enough_for_the_pillar_to_have_a_score(self) -> None:
        """And the score is read against the pillar's **whole** weight, not just the part that
        scored: 5.4 points of a possible 10 is 54, because the rollup divides the contribution by
        the weight it was given (`pillars_of`: "a rollup, never a second calculation").

        **`is not None` was the whole assertion, and 54 is the thing that can be wrong.** A
        rollup that divided by the scored weight alone reported 90 -- a pillar at near-full marks
        on four tenths of no evidence -- and the suite had nothing to say about it.
        """
        rolled = pillars_of(
            [a_row("nature", score=None, weight="4"), a_row("nature", score=90, weight="6")]
        )

        assert rolled[0].score == 54

    def test_a_pillar_whose_weight_redistributed_away_has_no_score(self) -> None:
        """Dividing by a zero weight is undefined, and there is nothing to report."""
        rolled = pillars_of([a_row("culture", score=70, weight="0", contribution="0")])

        assert rolled[0].score is None

    def test_pillars_come_back_in_the_order_the_criteria_set_lists_them(self) -> None:
        """Not alphabetically: the set's own order is a judgement about what to read first."""
        rolled = pillars_of([a_row("safety"), a_row("economics"), a_row("housing")])

        assert [str(p.pillar) for p in rolled] == ["safety", "economics", "housing"]

    def test_an_empty_breakdown_rolls_up_to_nothing(self) -> None:
        assert pillars_of([]) == ()


class TestTheDifferenceAgainstHome:
    def test_it_is_the_plain_difference_of_two_scores(self) -> None:
        assert delta_against(71, 60, is_home=False) == Decimal(11)
        assert delta_against(52, 60, is_home=False) == Decimal(-8)

    def test_home_itself_has_no_difference_rather_than_a_zero(self) -> None:
        """A zero would sit in a column of real differences looking like one."""
        assert delta_against(60, 60, is_home=True) is None

    @pytest.mark.parametrize(
        ("score", "home"),
        [(None, 60), (71, None), (None, None)],
    )
    def test_a_difference_against_an_unscoreable_candidate_is_unanswerable(
        self, score: int | None, home: int | None
    ) -> None:
        assert delta_against(score, home, is_home=False) is None


class TestWhereTheDifferenceAgainstHomeIsApplied:
    """`rank_candidates`' second pass, which is the part that has to find home (`reqs.md` 1.2).

    **The helper above was tested and its call site was not**, which left the two decisions that
    only the ranking can make unexercised: which candidate is home, and what happens when there
    is none in this ranking. A pass that attached every difference to the wrong candidate would
    have satisfied the whole suite.
    """

    @staticmethod
    def three_countries(**overrides: object):
        """Portugal, Spain and Italy on one percentile criterion: 10, 5 and 0 of a scale of 10."""
        return {
            str(result.candidate): result
            for result in rank_candidates(
                criteria=a_set([a_criterion()]),
                level="country",
                values=values_for(portugal=90, spain=50, italy=10),
                score_scale_max=A_SMALL_SCALE,
                **overrides,  # type: ignore[arg-type]
            )
        }

    def test_home_anchors_the_column_and_carries_no_difference_itself(self) -> None:
        """A zero there would sit in a column of real differences looking like one."""
        found = self.three_countries(home_candidate=HOME)

        assert found[HOME].score == A_SMALL_SCALE
        assert found[HOME].delta_vs_home is None

    def test_every_other_candidate_carries_its_difference_from_home(self) -> None:
        """Spain scores 5 against Portugal's 10, Italy 0: five behind and ten behind."""
        found = self.three_countries(home_candidate=HOME)

        assert found["country.spain"].delta_vs_home == Decimal(-5)
        assert found["country.italy"].delta_vs_home == Decimal(-10)

    def test_the_difference_is_measured_against_home_and_not_against_the_leader(self) -> None:
        """Home in the middle of the ranking, which is the case that tells the two apart: Spain
        is home, so Portugal is five ahead and Italy five behind -- and the leader's own
        difference is a real number rather than the null that belongs to home.
        """
        found = self.three_countries(home_candidate="country.spain")

        assert found["country.spain"].delta_vs_home is None
        assert found[HOME].delta_vs_home == Decimal(5)
        assert found["country.italy"].delta_vs_home == Decimal(-5)

    def test_no_household_means_no_difference_for_anybody(self) -> None:
        """There is nothing to be different from, and 0 would say "the same as home"."""
        found = self.three_countries()

        assert [result.delta_vs_home for result in found.values()] == [None, None, None]

    def test_a_home_absent_from_this_ranking_leaves_every_difference_null(self) -> None:
        """A household that named a country nobody fetched, or a ranking at the other level."""
        found = self.three_countries(home_candidate="country.germany")

        assert [result.delta_vs_home for result in found.values()] == [None, None, None]
