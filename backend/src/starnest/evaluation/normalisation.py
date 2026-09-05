"""Turning measured figures into scores on the configured scale (`reqs.md` 5.1).

Two of the three methods, because those are the two that can run today.

**`percentile` needs no configuration at all**, which is why the first ranking this application
ever produces uses it: a candidate's score is its standing among the candidates being ranked,
so real values alone are enough. Nothing has to be invented, and `devplan.md` 0.3's stop rule
is never approached.

**`as_is` needs the figure to already be a score**, and refuses when it is not. That refusal is
the whole of its value: a Numbeo index published 0-100 read onto a scale of 10 would produce
plausible numbers that are wrong by a factor of ten, and nothing downstream could tell.

**`fixed` is absent deliberately.** It interpolates between anchor points and no anchor ships
(`reqs.md` 7.1, `devplan.md` 0.3) -- 26 of the 41 shipped criteria declare it and every one of
them has an empty scale, because the anchors are the user's to set against real figures. Code
here would be code nothing could exercise.

**A score is an integer on 0..`score_scale_max`.** The scale is a setting the user edits
(`reqs.md` 3.10), never the literal 100, and it arrives as an argument for that reason.
"""

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

from starnest.criteria import Goal, NormalisationMethod


class NormalisationError(ValueError):
    """A figure could not honestly be turned into a score on this scale."""


def scores_for(
    figures: Sequence[Decimal],
    *,
    method: NormalisationMethod,
    goal: Goal,
    score_scale_max: int,
) -> tuple[int, ...]:
    """One criterion's column of figures, as scores, in the order the figures were given.

    A column rather than one figure at a time, because `percentile` is a comparison between
    candidates and has no answer for a single figure in isolation. `as_is` does not need the
    column and takes it anyway, so that the caller has one shape to hold and cannot pair the
    wrong method with the wrong call.
    """
    if score_scale_max <= 0:
        raise NormalisationError(
            f"a score scale must have a top; {score_scale_max} leaves no score to award"
        )
    if method is NormalisationMethod.PERCENTILE:
        return _by_standing(figures, goal=goal, score_scale_max=score_scale_max)
    if method is NormalisationMethod.AS_IS:
        return tuple(
            _already_a_score(f, goal=goal, score_scale_max=score_scale_max) for f in figures
        )
    raise NormalisationError(
        f"{method} cannot be applied yet; only percentile and as_is are implemented "
        "(docs/mine2e.md M1)"
    )


def _already_a_score(figure: Decimal, *, goal: Goal, score_scale_max: int) -> int:
    """The figure is the score, once the goal has had its say.

    Refusing an out-of-range figure rather than clamping it: clamping turns a source that
    disagrees with the declared scale into a plausible score at the boundary, and every
    candidate whose figure overshoots then ties at the top for a reason nobody can see.
    """
    if not 0 <= figure <= score_scale_max:
        raise NormalisationError(
            f"{figure} is not a score on a scale of 0 to {score_scale_max}; `as_is` is for "
            "figures already on the score scale, and rescaling one is what `fixed` is for"
        )
    scored = figure if goal is Goal.MAXIMISE else Decimal(score_scale_max) - figure
    return int(scored.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _by_standing(
    figures: Sequence[Decimal], *, goal: Goal, score_scale_max: int
) -> tuple[int, ...]:
    """Each figure scored by the share of the others it is strictly better than.

    One sentence, and every consequence follows from it rather than from a convention nobody
    can reconstruct later.

    **Ties score equally**, whichever order they arrived in -- two candidates with identical
    rent must, and counting strictly-worse figures gives that for free where sorting and taking
    an index would not.

    **A tie at the top means nobody reaches the top of the scale**, because neither candidate
    beat the other. That reads oddly until you say the rule aloud, and then it is simply true.
    A column of identical figures scores every candidate zero for the same reason: nobody beat
    anybody. Such a criterion discriminates nothing, so contributing nothing to every total is
    the right answer rather than a quirk.

    **Standing, not distance** (`reqs.md` 5.1). Three figures within a hair of each other still
    score 0, half and full, because percentile is about position among these candidates and not
    about the size of the gaps -- which is exactly why it needs no anchors and can run today.
    """
    if not figures:
        return ()
    if len(figures) == 1:
        # A single candidate beats nobody and loses to nobody, so it sits at the top and the
        # bottom of the column at once. Awarding the top would call it excellent, awarding zero
        # would call it terrible, and the midpoint would be a number chosen because it is
        # unobjectionable rather than because anything measured it. All three are fabrications,
        # so this refuses instead -- `reqs.md`'s rule is that the honest answer to "we cannot
        # say" is to say so.
        raise NormalisationError(
            "percentile scores a candidate by its standing among the others, and one candidate "
            "has no others; rank more than one, or use a method that scores a figure on its "
            "own terms"
        )

    scale = Decimal(score_scale_max)
    worst_beaten = len(figures) - 1
    return tuple(
        int(
            (Decimal(_beaten_by(figure, figures, goal)) / worst_beaten * scale).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
        for figure in figures
    )


def _beaten_by(figure: Decimal, figures: Sequence[Decimal], goal: Goal) -> int:
    """How many of the column this figure is strictly better than."""
    if goal is Goal.MINIMISE:
        return sum(1 for other in figures if other > figure)
    return sum(1 for other in figures if other < figure)
