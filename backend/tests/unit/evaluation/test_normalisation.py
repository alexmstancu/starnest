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

from starnest.criteria import Goal, NormalisationMethod
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


def test_fixed_is_refused_rather_than_silently_wrong() -> None:
    """26 of the 41 shipped criteria declare `fixed` and none ships an anchor.

    Saying so is the point: a caller that reaches this has configured something that cannot run,
    and an empty result would look like a criterion with no data rather than one not built yet.
    """
    with pytest.raises(NormalisationError, match="only percentile and as_is"):
        scores_for(
            [Decimal("1")],
            method=NormalisationMethod.FIXED,
            goal=Goal.MAXIMISE,
            score_scale_max=A_SMALL_SCALE,
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
