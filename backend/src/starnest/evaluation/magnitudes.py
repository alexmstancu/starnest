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

    Under `percentile` this settles nothing and needs to: every candidate is ranked on the one
    provider's scale, so where that scale starts and stops cancels out.

    Under `as_is` it is a real question left open. An `Index` carries `scale_min` and
    `scale_max`, and its own docstring notes that those bounds would allow a deterministic
    rescaling with no anchor anyone had to invent -- so rescaling 0-100 onto a scale of 10
    would not be the fabrication that rescaling usually is. Reading the figure as published is
    the conservative half of that: it can refuse, and it can never quietly report a number ten
    times too large. Deciding the other half is not needed until an index is scored `as_is`
    against a scale that is not its own.
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
