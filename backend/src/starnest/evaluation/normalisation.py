"""Turning measured figures into scores on the configured scale (`reqs.md` 5.1).

Two of the three methods, because those are the two that can run today.

**`percentile` needs no configuration at all**, which is why the first ranking this application
ever produces uses it: a candidate's score is its standing among the candidates being ranked,
so real values alone are enough. Nothing has to be invented, and `devplan.md` 0.3's stop rule
is never approached.

**`as_is` takes the figure as the score**, and refuses one that is not on the scale -- unless
its publisher declared the scale it *is* on, in which case it is mapped across. Decided
2026-09-05 (`docs/d6-scale-anchors.md`): rescaling from bounds the source published invents
nothing, and it is what separates this from `fixed`, which interpolates between anchor points
somebody chooses. Without it, a World Bank governance figure of 0.72 and a Numbeo index of 72
mean similar things and score forty-fold apart.

Where no bounds are declared the refusal stands, and it is still the greater part of the
method's value: a figure that is neither on the score scale nor on a stated one of its own is a
number nobody can place.

**`fixed` maps a figure between anchors the user chose, linearly between** (`reqs.md` 5.1),
and it is the only method whose score is *stable*: it reads the figure and the anchors and
nothing else, so a candidate's score does not move when another is added. Beyond the outermost
anchors the score holds at theirs -- extrapolating would leave the score range. The anchors
carry the direction, so `goal` is not applied on top of them; a set of anchors that contradicts
its goal is refused where the criterion is declared, not here. **With no anchors it refuses**:
26 shipped criteria declare `fixed` with none chosen yet, and inventing a scale is exactly what
this module must not do.

**A score is an integer on 0..`score_scale_max`.** The scale is a setting the user edits
(`reqs.md` 3.10), never the literal 100, and it arrives as an argument for that reason.
"""

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal
from itertools import pairwise

from starnest.criteria import Goal, NormalisationMethod, ScaleAnchor
from starnest.evaluation.magnitudes import PublishedFigure


class NormalisationError(ValueError):
    """A figure could not honestly be turned into a score on this scale."""


def scores_for(
    figures: Sequence[PublishedFigure] | Sequence[Decimal],
    *,
    method: NormalisationMethod,
    goal: Goal,
    score_scale_max: int,
    anchors: Sequence[ScaleAnchor] = (),
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
    published = tuple(
        figure if isinstance(figure, PublishedFigure) else PublishedFigure(figure)
        for figure in figures
    )
    if method is NormalisationMethod.PERCENTILE:
        return _by_standing(
            [figure.magnitude for figure in published],
            goal=goal,
            score_scale_max=score_scale_max,
        )
    if method is NormalisationMethod.AS_IS:
        return tuple(
            _already_a_score(figure, goal=goal, score_scale_max=score_scale_max)
            for figure in published
        )
    return tuple(_on_the_anchored_scale(figure, anchors, goal=goal) for figure in published)


def _on_the_anchored_scale(
    figure: PublishedFigure, anchors: Sequence[ScaleAnchor], *, goal: Goal
) -> int:
    """Where the figure falls between the user's anchors, as a score.

    Read off the figure's own magnitude, in the attribute's unit -- the anchors are written in
    that unit ("20% scores 10"), so a published scale an index carries is not consulted here.
    """
    if goal is Goal.TARGET_RANGE:
        raise NormalisationError(
            "a target_range goal is its own four numbers, not a set of anchors, and is not "
            "built yet"
        )
    if not anchors:
        raise NormalisationError(
            "this criterion normalises `fixed` and has no scale anchors chosen yet; choosing "
            "them is what makes a fixed score, and nothing here invents one"
        )
    points = sorted(anchors, key=lambda anchor: anchor.input_value)
    figure_value = figure.magnitude
    if figure_value <= points[0].input_value:
        return points[0].score
    if figure_value >= points[-1].input_value:
        return points[-1].score
    low, high = next(
        (low, high)
        for low, high in pairwise(points)
        if low.input_value <= figure_value <= high.input_value
    )
    along = (figure_value - low.input_value) / (high.input_value - low.input_value)
    placed = Decimal(low.score) + along * (high.score - low.score)
    return int(placed.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _already_a_score(figure: PublishedFigure, *, goal: Goal, score_scale_max: int) -> int:
    """The figure as a score, mapped from its published scale where it declares one.

    Refusing an out-of-range figure rather than clamping it: clamping turns a source that
    disagrees with the declared scale into a plausible score at the boundary, and every
    candidate whose figure overshoots then ties at the top for a reason nobody can see.
    """
    on_the_score_scale = _mapped(figure, score_scale_max)
    if not 0 <= on_the_score_scale <= score_scale_max:
        raise NormalisationError(
            f"{figure.magnitude} is not a score on a scale of 0 to {score_scale_max} and "
            "declares no scale of its own; `as_is` is for a figure that is already a score, "
            "and choosing where one sits is what `fixed` is for"
        )
    scored = (
        on_the_score_scale
        if goal is Goal.MAXIMISE
        else Decimal(score_scale_max) - on_the_score_scale
    )
    return int(scored.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _mapped(figure: PublishedFigure, score_scale_max: int) -> Decimal:
    """A published figure moved onto the score scale, or left alone where it declares none.

    Linear between the publisher's own bounds, so the bottom of their scale is 0 and the top is
    the whole of ours.

    **A figure outside the bounds it declares needs no guard here**, which is worth stating
    because the obvious one was written and then removed: the mapping is monotonic, so anything
    below the publisher's floor maps below 0 and anything above their ceiling maps above the
    score scale, and `_already_a_score` refuses both. A guard that cannot change an outcome
    reads as a case that happens. `Index` also refuses to construct a value outside the scale it
    declares, so the source would have to contradict itself twice.

    Inverted bounds are a different matter and are checked: they would divide by a negative and
    turn the whole scale upside down without ever leaving the range.
    """
    if figure.published_bounds is None:
        return figure.magnitude
    lowest, highest = figure.published_bounds
    if highest <= lowest:
        return figure.magnitude
    return (figure.magnitude - lowest) / (highest - lowest) * Decimal(score_scale_max)


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
