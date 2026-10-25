"""The one number a value contributes to a score, and the values that contribute none.

Six of the ten value types carry a figure that can be compared across candidates. The other
four do not, and that is not a gap: a Köppen climate zone, a set of treaty partners and a
paragraph of prose are facts worth displaying and worth matching against a threshold, but
there is no arithmetic that puts `Cfb` above `Dfb` (`reqs.md` 3.3a). Scoring them would mean
inventing an order nobody published.

**Reading `Monetary` as its EUR equivalent is the load-bearing choice here.** Comparing 2,900
CHF against 1,410 EUR as bare numbers is the failure the whole currency rule exists to prevent,
and it fails silently -- the arithmetic works, the ranking appears, and Switzerland looks twice
as expensive as it is. `amount_eur` is the only figure of a `Monetary` that means the same
thing for every candidate (`reqs.md` 5.5).
"""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final

from starnest.data import (
    AssignedScore,
    Count,
    Index,
    Monetary,
    Quantity,
    Ratio,
    Value,
    ValueType,
)


class UnscoreableValueError(ValueError):
    """This value cannot contribute a number, and saying so is the honest answer.

    Raised rather than returned as `None` so that a caller who forgets the case gets an error
    instead of a score computed from a missing figure. The ranking catches it deliberately, in
    one place, and records the criterion as unanswered -- which is what makes coverage a real
    measurement rather than a count of rows.
    """


def _euro_equivalent(payload: Monetary) -> Decimal:
    return payload.amount_eur


def _magnitude(payload: Quantity) -> Decimal:
    return payload.magnitude


def _count(payload: Count) -> Decimal:
    return Decimal(payload.count)


def _share(payload: Ratio) -> Decimal:
    return payload.value


def _published_figure(payload: Index) -> Decimal:
    """The provider's own number, unrescaled.

    Under `percentile` the bounds are read as well (P49), and the claim that stood here -- that
    every candidate is ranked on the one provider's scale, so where it starts and stops cancels
    out -- was the unsafe half of a contradiction with `PublishedFigure` below, which says
    bounds travel with the figure precisely because two candidates may hold different
    providers'. They cancel out only while there is one provider; `normalisation` now reads each
    figure as a fraction of its own scale, which changes nothing when there is.

    Under `as_is` the figure is read as published here and rescaled by `normalisation`, from the
    bounds `figure_of` attaches. Decided 2026-09-05 (`docs/d6-scale-anchors.md`): rescaling from
    bounds the PUBLISHER declared invents nothing, which is what separates it from `fixed` --
    `fixed` interpolates between anchor points somebody chooses, and this reads a mapping the
    source already published. Ten of the shipped set's criteria turned on it.
    """
    return payload.value


def _assigned(payload: AssignedScore) -> Decimal:
    return payload.value


# `Any` because the lookup is keyed on the very field that decides the payload's type: the
# composite key in `value` and the discriminated union in `data/` both guarantee they agree,
# and neither fact is visible to a type checker through a dictionary.
_READERS: Final[dict[ValueType, Callable[[Any], Decimal]]] = {
    ValueType.MONETARY: _euro_equivalent,
    ValueType.QUANTITY: _magnitude,
    ValueType.COUNT: _count,
    ValueType.RATIO: _share,
    ValueType.INDEX: _published_figure,
    ValueType.ASSIGNED_SCORE: _assigned,
}
"""The six types that carry a comparable figure, and how to read each.

A table rather than a chain of `isinstance` checks, so that adding a numeric value type is one
line and forgetting one is a `KeyError` at the seam rather than a branch that silently returns
zero.
"""


@dataclass(frozen=True)
class PublishedFigure:
    """A figure, and the scale it was published or assigned on if it declares one.

    **The bounds travel with the figure rather than with the attribute**, because two candidates
    can legitimately hold values from different providers for the same attribute -- that is what
    the multi-source design is for -- and two judgements may be given on different ranges. Each
    must be read on its own scale; a bound taken from the attribute would silently apply one
    figure's scale to another's number.
    """

    magnitude: Decimal
    published_bounds: tuple[Decimal, Decimal] | None = None


def is_scoreable(value_type: ValueType) -> bool:
    """Whether this type carries a figure a score can be computed from at all."""
    return value_type in _READERS


def magnitude_of(value: Value) -> Decimal:
    """The comparable figure this value contributes.

    Raises `UnscoreableValueError` when there is none: the value was rejected and holds
    nothing, or its type is one of the four that carry no number.
    """
    if value.payload is None:
        raise UnscoreableValueError(
            f"{value.attribute} for {value.candidate} holds no figure: {value.rejection_reason}"
        )
    reader = _READERS.get(value.value_type)
    if reader is None:
        raise UnscoreableValueError(
            f"{value.attribute} is a {value.value_type}, which carries no figure to compare "
            "across candidates; it is matched against a threshold, never scored"
        )
    return reader(value.payload)


def figure_of(value: Value) -> PublishedFigure:
    """The comparable figure, with the scale it was put on where its type declares one.

    An `Index` declares its publisher's scale, an `AssignedScore` the range it was assigned on,
    a `Ratio` the 0 to 100 every share sits on (`Payload.declared_scale`). **Asked of the
    payload, not decided here**: this decided it once, for an `Index` alone, and an assigned
    score's range reached storage only to be dropped at this line (PL-083, UF-071).
    """
    magnitude = magnitude_of(value)
    assert value.payload is not None, "magnitude_of refuses a value that holds nothing"
    return PublishedFigure(magnitude, value.payload.declared_scale())


def share_of_its_scale(figure: PublishedFigure) -> Decimal | None:
    """How far up the scale it declares the figure sits: 0 at the bottom, 1 at the top.

    None where it declares no scale to be read on: none at all, or one that does not run from
    low to high -- which no payload can declare, and which `scores_for`, being public, can still
    be handed. Reading it would divide by nothing or turn the scale upside down.

    The one place this is computed, so `as_is` and `percentile` cannot disagree about where a
    figure sits.
    """
    if figure.published_bounds is None:
        return None
    lowest, highest = figure.published_bounds
    if highest <= lowest:
        return None
    return (figure.magnitude - lowest) / (highest - lowest)


def threshold_reading(value: Value) -> Decimal:
    """The figure a threshold or a compound condition compares (C06-S1, `reqs.md` 5.2).

    **An assigned score is read as a percentage of the scale it was given on** (N2): 7 on 0 to
    10 is 70, so a minimum of 50 admits it, and the same judgement given on 0 to 100 reads the
    same. Its raw figure means nothing across ranges, and the score scale moves when the
    household sets it, so neither could be a line somebody draws once. Every other figure is
    its magnitude in the attribute's unit -- an `Index` keeps its publisher's, which the
    attribute declares once, and a `Ratio`'s share already is a percentage.
    """
    figure = figure_of(value)
    if isinstance(value.payload, AssignedScore):
        share = share_of_its_scale(figure)
        assert share is not None, "an assigned score always declares a range running upwards"
        return share * 100
    return figure.magnitude
