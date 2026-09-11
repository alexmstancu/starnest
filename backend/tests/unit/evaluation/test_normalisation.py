"""Figures becoming scores, and the figures that honestly cannot.

`reqs.md` 5.1's two runnable methods. `fixed` is not tested because it is not implemented: no
anchor ships, so it could not run against real data and code for it would be code nothing
exercises (`docs/mine2e.md` M1).

**The scale in this file is 10, not 100.** `settings.score_scale_max` is a setting the user
edits (`reqs.md` 3.10), and a test that passes only when the scale happens to be 100 would let a
hardcoded ceiling through unnoticed. Where a case is genuinely about the boundary rather than
the scale, it says which scale it means.
"""

from decimal import Decimal

import pytest

from starnest.criteria import Goal, NormalisationMethod, ScaleAnchor, TargetRange
from starnest.evaluation import NormalisationError, PublishedFigure, scores_for

A_SMALL_SCALE = 10


def percentile(figures: list[str], *, goal: Goal = Goal.MAXIMISE, scale: int = A_SMALL_SCALE):
    return scores_for(
        [Decimal(f) for f in figures],
        method=NormalisationMethod.PERCENTILE,
        goal=goal,
        score_scale_max=scale,
    )


def as_is(figures: list[str], *, goal: Goal = Goal.MAXIMISE, scale: int = A_SMALL_SCALE):
    return scores_for(
        [Decimal(f) for f in figures],
        method=NormalisationMethod.AS_IS,
        goal=goal,
        score_scale_max=scale,
    )


class TestPercentileScoresStandingAmongTheCandidates:
    def test_the_best_takes_the_top_of_the_scale_and_the_worst_takes_zero(self) -> None:
        """With no ties, the column spans the scale however narrow the spread underneath it."""
        assert percentile(["1", "5", "9"]) == (0, 5, 10)

    def test_a_narrow_spread_still_spans_the_scale(self) -> None:
        """Standing, not distance. Three figures within a hair of each other still rank."""
        assert percentile(["4.10", "4.11", "4.12"]) == (0, 5, 10)

    def test_minimising_reverses_which_end_is_good(self) -> None:
        """The same column, read as rent rather than as salary."""
        assert percentile(["1", "5", "9"], goal=Goal.MINIMISE) == (10, 5, 0)

    def test_equal_figures_score_equally_whatever_order_they_arrive_in(self) -> None:
        """Two candidates with identical rent must score identically.

        Counting strictly-worse figures gives this; sorting and taking an index would give the
        first of the pair a better score for no reason a reader could find.

        Each 5 beats only the 1, so each scores 3 of 10 rather than the 5 a midpoint convention
        would give. That follows from the stated rule -- the share you are strictly better than
        -- and the rule is what a reader can reconstruct a year from now.
        """
        assert percentile(["5", "1", "5", "9"]) == (3, 0, 3, 10)

    def test_a_tie_at_the_top_leaves_the_top_of_the_scale_unawarded(self) -> None:
        """Neither of the two best beat the other, so neither takes the whole scale.

        Worth an explicit test because it is the consequence people find surprising, and a
        future "fix" that awards both the top would break the rule the rest of the file rests
        on.
        """
        assert percentile(["9", "9", "1"]) == (5, 5, 0)

    def test_every_figure_equal_scores_every_candidate_zero(self) -> None:
        """Nobody beats anybody. A flat column discriminates nothing, and says so."""
        assert percentile(["7", "7", "7"]) == (0, 0, 0)

    def test_scores_follow_the_configured_scale_and_not_a_hundred(self) -> None:
        """The same three figures on two scales. A hardcoded ceiling fails this."""
        assert percentile(["1", "5", "9"], scale=100) == (0, 50, 100)
        assert percentile(["1", "5", "9"], scale=4) == (0, 2, 4)

    def test_ranking_a_single_candidate_is_refused(self) -> None:
        """It sits at the top and the bottom of its column at once.

        The top would call it excellent, zero would call it terrible, and the midpoint would be
        a number chosen for being unobjectionable rather than measured. Refusing is the only
        answer `reqs.md` permits.
        """
        with pytest.raises(NormalisationError, match="one candidate has no others"):
            percentile(["5"])

    def test_no_candidates_produce_no_scores(self) -> None:
        """Not an error: an attribute nobody has a figure for is a normal state."""
        assert percentile([]) == ()


class TestAsIsTakesTheFigureAsTheScore:
    def test_a_figure_on_the_scale_is_the_score(self) -> None:
        assert as_is(["0", "7", "10"]) == (0, 7, 10)

    def test_minimising_reflects_the_figure_through_the_scale(self) -> None:
        """A score of 2 on a scale of 10, read as "lower is better", is an 8."""
        assert as_is(["0", "2", "10"], goal=Goal.MINIMISE) == (10, 8, 0)

    def test_a_figure_above_the_scale_is_refused_rather_than_clamped(self) -> None:
        """The refusal is the whole value of the method.

        A Numbeo index published 0-100 read onto a scale of 10 would clamp to 10 for every
        candidate, and the ranking would show a perfect tie nobody could explain.
        """
        with pytest.raises(NormalisationError, match="not a score on a scale of 0 to 10"):
            as_is(["62"])

    def test_a_negative_figure_is_refused(self) -> None:
        """The other end of the same objection."""
        with pytest.raises(NormalisationError, match="not a score on a scale"):
            as_is(["-1"])

    def test_a_figure_at_either_boundary_is_accepted(self) -> None:
        """The bounds belong to the scale: a scale of 10 has both a 0 and a 10."""
        assert as_is(["0", "10"]) == (0, 10)

    def test_a_fractional_figure_becomes_an_integer_score(self) -> None:
        """Scores are integers (`reqs.md` 5.1); the stored figure keeps its precision."""
        assert as_is(["7.4", "7.5"]) == (7, 8)

    def test_one_candidate_is_fine_because_the_figure_stands_alone(self) -> None:
        """The contrast with percentile, and why both methods exist."""
        assert as_is(["7"]) == (7,)


class TestTheScaleItselfMustBeUsable:
    @pytest.mark.parametrize("scale", [0, -1], ids=["no top", "a negative top"])
    def test_a_scale_with_no_top_is_refused(self, scale: int) -> None:
        """`settings.score_scale_max` is nullable and unseeded, so this case is reachable."""
        with pytest.raises(NormalisationError, match="must have a top"):
            percentile(["1", "2"], scale=scale)


# --- fixed: anchors chosen by the user, linearly between (reqs.md 5.1) ----------------------


def anchored(*points: tuple[str, int]) -> tuple[ScaleAnchor, ...]:
    return tuple(ScaleAnchor(input_value=Decimal(value), score=score) for value, score in points)


def fixed(figures: list[str], anchors, *, scale: int = A_SMALL_SCALE):
    return scores_for(
        [Decimal(f) for f in figures],
        method=NormalisationMethod.FIXED,
        goal=Goal.MINIMISE,
        score_scale_max=scale,
        anchors=anchors,
    )


# A tax scale on a score scale of 10: 20% or less is full marks, 40% or more is nothing.
A_TAX_SCALE = anchored(("20", 10), ("40", 0))


class TestFixedMapsBetweenTheAnchorsTheUserChose:
    def test_a_figure_between_two_anchors_is_placed_linearly(self) -> None:
        """30% is halfway from 20 to 40, so it scores halfway from 10 to 0."""
        assert fixed(["30"], A_TAX_SCALE) == (5,)

    def test_a_figure_on_an_anchor_scores_exactly_that_anchor(self) -> None:
        assert fixed(["20", "40"], A_TAX_SCALE) == (10, 0)

    def test_beyond_the_outermost_anchors_the_score_holds_at_theirs(self) -> None:
        """Clamped, because extrapolating would leave the score range: a 45% rate is not
        "less than nothing", and an 18% rate is not "more than full marks"."""
        assert fixed(["18.1", "58.6"], A_TAX_SCALE) == (10, 0)

    def test_three_anchors_make_two_slopes(self) -> None:
        """The reason anchors are a list rather than two numbers: 20 to 30 might matter more
        than 30 to 40, and only a middle anchor can say so."""
        steep_then_shallow = anchored(("20", 10), ("30", 2), ("40", 0))

        assert fixed(["25", "35"], steep_then_shallow) == (6, 1)

    def test_the_order_the_anchors_were_declared_in_does_not_matter(self) -> None:
        assert fixed(["30"], tuple(reversed(A_TAX_SCALE))) == (5,)

    def test_the_score_rounds_half_up_like_every_other_method(self) -> None:
        """29% is 5.5 on the way down from 10: half up is 6."""
        assert fixed(["29"], A_TAX_SCALE) == (6,)


class TestFixedIsStable:
    """`reqs.md` 5.1: a candidate's score "does not change when another candidate is added or
    removed". The property that separates `fixed` from `percentile`."""

    def test_one_figure_alone_is_scored(self) -> None:
        """`percentile` refuses a single candidate -- there is no standing to report. `fixed`
        needs no others at all."""
        assert fixed(["30"], A_TAX_SCALE) == (5,)

    def test_adding_a_candidate_does_not_move_anyone_else(self) -> None:
        alone = fixed(["30"], A_TAX_SCALE)
        among_others = fixed(["30", "18.1", "58.6", "41.5"], A_TAX_SCALE)

        assert among_others[0] == alone[0]


class TestFixedRefusesWhatItCannotPlace:
    def test_no_anchors_is_refused_and_says_they_are_missing(self) -> None:
        """26 shipped criteria declare `fixed` with none chosen yet. The refusal names the
        missing anchors, because choosing them -- not fetching anything -- is the fix."""
        with pytest.raises(NormalisationError, match="no scale anchors"):
            fixed(["30"], ())

    def test_a_target_range_without_its_four_numbers_is_refused(self) -> None:
        """A target range is its own four numbers (`reqs.md` 5.1), never a set of anchors. A
        criterion that names fewer has not said what scores zero, and nothing here decides it."""
        with pytest.raises(NormalisationError, match="four numbers"):
            scores_for(
                [Decimal("30")],
                method=NormalisationMethod.FIXED,
                goal=Goal.TARGET_RANGE,
                score_scale_max=A_SMALL_SCALE,
                anchors=A_TAX_SCALE,
            )


# --- as_is over a published index (D6 (A), decided 2026-09-05) -------------------------------


def published(figure: str, *, bounds: tuple[str, str] | None = None) -> PublishedFigure:
    return PublishedFigure(
        Decimal(figure),
        None if bounds is None else (Decimal(bounds[0]), Decimal(bounds[1])),
    )


def as_is_published(figures, *, goal: Goal = Goal.MAXIMISE, scale: int = A_SMALL_SCALE):
    return scores_for(figures, method=NormalisationMethod.AS_IS, goal=goal, score_scale_max=scale)


class TestAnIndexIsReadOnTheScaleItsPublisherDeclared:
    """`docs/d6-scale-anchors.md` (A). Rescaling from bounds the SOURCE published invents
    nothing, which is what separates it from `fixed` -- `fixed` interpolates between anchor
    points somebody chooses, and this reads a mapping that already exists."""

    def test_a_figure_on_its_own_scale_maps_onto_the_score_scale(self) -> None:
        """Numbeo publishes 0-100. On a score scale of 10, 72 is a 7."""
        assert as_is_published([published("72", bounds=("0", "100"))]) == (7,)

    def test_a_scale_that_starts_below_zero_maps_too(self) -> None:
        """The World Bank's governance indicators run -2.5 to 2.5, so 0.72 is well above the
        middle -- and unmapped it would have scored 0.72 out of 100, forty-fold adrift of a
        Numbeo index meaning something similar."""
        assert as_is_published([published("0.72", bounds=("-2.5", "2.5"))], scale=100) == (64,)

    def test_the_ends_of_a_published_scale_are_the_ends_of_ours(self) -> None:
        column = [published("0", bounds=("0", "100")), published("100", bounds=("0", "100"))]

        assert as_is_published(column) == (0, A_SMALL_SCALE)

    def test_two_publishers_scales_are_each_read_on_their_own(self) -> None:
        """Why the bounds travel with the figure and not with the attribute: the multi-source
        design exists so two candidates may hold values from different providers."""
        numbeo = published("50", bounds=("0", "100"))
        world_bank = published("0", bounds=("-2.5", "2.5"))

        assert as_is_published([numbeo, world_bank]) == (5, 5)

    def test_a_figure_with_no_declared_scale_is_still_taken_as_it_stands(self) -> None:
        """The behaviour every other value type keeps: only an Index declares bounds."""
        assert as_is_published([published("7")]) == (7,)

    def test_a_figure_outside_the_bounds_it_declares_is_refused(self) -> None:
        """A source contradicting its own published range is a fault worth surfacing, not one
        to smooth over by clamping."""
        with pytest.raises(NormalisationError, match="not a score"):
            as_is_published([published("140", bounds=("0", "100"))])

    def test_minimising_reflects_the_mapped_figure(self) -> None:
        """A cost index of 72 on 0-100, read as "lower is better", is a 3 out of 10."""
        assert as_is_published([published("72", bounds=("0", "100"))], goal=Goal.MINIMISE) == (3,)

    def test_bounds_the_wrong_way_round_do_not_invert_the_scale(self) -> None:
        """`Index` refuses to declare these, but `scores_for` is public and takes a figure
        directly -- and dividing by a negative span would turn every score upside down while
        staying inside the range, so nothing downstream could tell.

        Left as it stands instead, which the range check below then judges on its merits.
        """
        assert as_is_published([published("7", bounds=("10", "0"))]) == (7,)


MILD = TargetRange(
    minimum=Decimal(12), maximum=Decimal(16), zero_below=Decimal(4), zero_above=Decimal(24)
)
"""12-16 °C scores full marks, falling to 0 by 4 °C and by 24 °C -- in the attribute's own unit."""


def on_the_band(
    *figures: str, target: TargetRange | None = MILD, scale: int = 100
) -> tuple[int, ...]:
    return scores_for(
        [Decimal(figure) for figure in figures],
        method=NormalisationMethod.FIXED,
        goal=Goal.TARGET_RANGE,
        score_scale_max=scale,
        target=target,
    )


class TestATargetRangeScoresTheBandAndFallsAwayFromIt:
    """`reqs.md` 5.1: everything in the band scores 100, the score falls linearly to 0 at each
    zero point, and every figure is a temperature you can check by eye."""

    def test_anywhere_in_the_band_scores_the_top_of_the_scale(self) -> None:
        assert on_the_band("12", "14", "16") == (100, 100, 100)

    def test_below_the_band_the_score_falls_linearly_to_the_lower_zero(self) -> None:
        """8 °C is halfway from 4 to 12, so half marks."""
        assert on_the_band("8") == (50,)

    def test_above_the_band_the_score_falls_linearly_to_the_upper_zero(self) -> None:
        """22 °C is three quarters of the way from 16 to 24."""
        assert on_the_band("22") == (25,)

    def test_at_and_beyond_a_zero_point_the_score_is_zero(self) -> None:
        assert on_the_band("4", "-3", "24", "31") == (0, 0, 0, 0)

    def test_the_band_scores_the_configured_scale_not_a_hundred(self) -> None:
        assert on_the_band("14", "8", scale=A_SMALL_SCALE) == (A_SMALL_SCALE, A_SMALL_SCALE // 2)

    def test_a_zero_point_on_the_band_edge_is_a_cliff_not_a_division_by_zero(self) -> None:
        cliff = TargetRange(
            minimum=Decimal(12), maximum=Decimal(16), zero_below=Decimal(12), zero_above=Decimal(24)
        )

        assert on_the_band("11.9", "12", target=cliff) == (0, 100)

    def test_the_anchors_are_not_consulted(self) -> None:
        """The four numbers are the whole scale; a stray anchor cannot bend it."""
        with_anchors = scores_for(
            [Decimal(8)],
            method=NormalisationMethod.FIXED,
            goal=Goal.TARGET_RANGE,
            score_scale_max=100,
            anchors=A_TAX_SCALE,
            target=MILD,
        )

        assert with_anchors == (50,)
