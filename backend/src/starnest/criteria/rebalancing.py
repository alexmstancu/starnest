"""Moving one weight, and what happens to its siblings.

This is the interaction the whole product turns on (arch.md 8.3). Weights sum to 100 within a
pillar, so raising one is only meaningful if the others fall to compensate -- which is why a
criteria set is a full copy and not a sparse overlay (reqs.md Q191), and why this arithmetic
lives on the server rather than in the client that drew the slider.

**A lock is the user saying "not this one".** Locked weights hold their value and are excluded
from redistribution, so the remainder absorbs the whole change. When there is no remainder to
absorb it, the move is refused with a message naming the locks -- that message is the reason
this check is here at all, rather than only as a database constraint.
"""

from decimal import Decimal
from typing import NamedTuple

TOTAL = Decimal(100)


class WeightsAllLockedError(ValueError):
    """Every weight that could have absorbed the change is locked.

    Carries the locked identifiers so the caller can say which ones, rather than making the
    user hunt for them. `openapi.yaml` surfaces this as `409 weights_all_locked`.
    """

    def __init__(self, moved: str, locked: tuple[str, ...]) -> None:
        self.moved = moved
        self.locked = locked
        listed = ", ".join(locked) if locked else "none"
        super().__init__(
            f"cannot change the weight of {moved}: every other weight in the pillar is locked "
            f"({listed}). Unlock at least one, or change it instead."
        )


class WeightedItem(NamedTuple):
    """One weight in a pillar. The identifier is an attribute id or a pillar id, depending on
    which of the two levels of weighting is being rebalanced -- the arithmetic is the same, so
    it is written once."""

    identifier: str
    weight: Decimal
    locked: bool


def rebalance(items: list[WeightedItem], *, moved: str, to: Decimal) -> dict[str, Decimal]:
    """Set one weight and redistribute across the unlocked others so the total stays 100.

    Redistribution is **proportional**: a sibling holding twice as much gives up twice as much,
    which preserves the shape of what you already decided instead of flattening it.

    Returns every identifier and its new weight, including those unchanged, so a caller writes
    one result rather than diffing.
    """
    _refuse_unless_valid(items, moved=moved, to=to)

    absorbers = [item for item in items if item.identifier != moved and not item.locked]
    if not absorbers:
        locked = tuple(
            item.identifier for item in items if item.identifier != moved and item.locked
        )
        raise WeightsAllLockedError(moved, locked)

    held = sum(
        (item.weight for item in items if item.identifier != moved and item.locked),
        Decimal(0),
    )
    available = TOTAL - to - held
    if available < 0:
        raise WeightsAllLockedError(
            moved,
            tuple(item.identifier for item in items if item.identifier != moved and item.locked),
        )

    absorbed = sum((item.weight for item in absorbers), Decimal(0))
    rebalanced = {moved: to}
    for item in absorbers:
        # An absorber at zero stays at zero under proportional sharing, so when every absorber
        # is at zero there is no proportion to go by and the remainder is split evenly. That is
        # the only sensible reading of "share this out among things that currently hold none".
        share = item.weight / absorbed if absorbed > 0 else Decimal(1) / Decimal(len(absorbers))
        rebalanced[item.identifier] = available * share
    for item in items:
        rebalanced.setdefault(item.identifier, item.weight)

    return _corrected_for_rounding(rebalanced, absorbers)


def _refuse_unless_valid(items: list[WeightedItem], *, moved: str, to: Decimal) -> None:
    if not items:
        raise ValueError("nothing to rebalance")
    if moved not in {item.identifier for item in items}:
        raise ValueError(f"{moved} is not one of these weights")
    if not (0 <= to <= TOTAL):
        raise ValueError(f"a weight is a percentage 0-100, not {to}")
    if len({item.identifier for item in items}) != len(items):
        raise ValueError("the same identifier appears twice")


def _corrected_for_rounding(
    rebalanced: dict[str, Decimal], absorbers: list[WeightedItem]
) -> dict[str, Decimal]:
    """Put any residue on the largest absorber.

    Proportional division of 100 rarely lands exactly -- three equal siblings give
    33.333... each. Full precision is kept (reqs.md 5.1 rounds only at display), but the
    remainder still has to go somewhere for the sum to be exactly 100, and the largest
    absorber is where it is least visible as a proportion of itself.
    """
    residue = TOTAL - sum(rebalanced.values(), Decimal(0))
    if residue == 0 or not absorbers:
        return rebalanced
    largest = max(absorbers, key=lambda item: rebalanced[item.identifier])
    rebalanced[largest.identifier] += residue
    return rebalanced
