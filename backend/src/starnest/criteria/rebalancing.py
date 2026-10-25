"""Moving one weight, and what happens to its siblings.

This is the interaction the whole product turns on (arch.md 8.3). Weights sum to 100 within a
pillar, so raising one is only meaningful if the others fall to compensate -- which is why a
criteria set is a full copy and not a sparse overlay (reqs.md Q191), and why this arithmetic
lives on the server rather than in the client that drew the slider.

**A lock is the user saying "not this one".** The weight it was placed on does not move, and a
locked sibling holds its value and is excluded from redistribution, so the remainder absorbs
the whole change. When the locks leave no arrangement that still sums to 100, the move is
refused with a message naming the locks that are actually in the way -- that message is the
reason this check is here at all, rather than only as a database constraint.
"""

from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from typing import NamedTuple

TOTAL = Decimal(100)

# **The places every redistributed weight is kept to** (Q240). Ten decimal places of a
# percentage is beyond anything a score can tell apart, and it is what makes every sum of weights
# exact: at Decimal's 28 significant digits a share like 26.09647210385405368134576799 cannot
# be added to its siblings without rounding, so a total the correction believed was 100 was
# stored as 100.000000000000000000000000004 -- and read back, rounded the other way, as
# 99.99999999999999999999999999, which the set's own check refused on every read.
WEIGHT_PLACES = Decimal("1e-10")
# Enough digits that no sum or share of weights in a pillar is ever rounded on the way.
EXACT = 60


class WeightsAllLockedError(ValueError):
    """A lock stands between the requested weight and a pillar that still sums to 100.

    Carries the locks actually in the way so the caller can name them, rather than making the
    user hunt for them. **Which locks those are differs by situation** -- the lock on the moved
    weight itself, or the ones on siblings that leave nothing to absorb the change -- so the
    sentence is composed at the point that knows, and a caller pointed at the wrong lock is
    sent looking for something that is not there (`reqs.md` 3.4).

    One type for all of them, because `openapi.yaml` surfaces every one as
    `409 weights_all_locked`. **`details.reason` says which situation it is** (PL-112), so a
    screen words each from fields rather than from the sentence: `moved_is_locked`,
    `only_weight`, `others_all_locked`, or `locks_leave_no_room` with the weight the locks
    `held` and the most the moved weight may ask for (`at_most`).
    """

    def __init__(
        self,
        moved: str,
        locked: tuple[str, ...],
        reason: str,
        *,
        kind: str,
        held: Decimal | None = None,
    ) -> None:
        self.moved = moved
        self.locked = locked
        super().__init__(f"cannot change the weight of {moved}: {reason}")
        details: dict[str, object] = {"reason": kind, "locked": list(locked)}
        if held is not None:
            details |= {"held": float(held), "at_most": float(TOTAL - held)}
        self.details = details


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
    _refuse_unless_the_locks_allow_it(items, moved=moved, to=to)

    absorbers = [item for item in items if item.identifier != moved and not item.locked]
    held = sum(
        (item.weight for item in items if item.identifier != moved and item.locked),
        Decimal(0),
    )
    available = TOTAL - to - held

    rebalanced = {moved: to}
    with localcontext() as context:
        context.prec = EXACT
        absorbed = sum((item.weight for item in absorbers), Decimal(0))
        for item in absorbers:
            # An absorber at zero stays at zero under proportional sharing, so when every
            # absorber is at zero there is no proportion to go by and the remainder is split
            # evenly. That is the only sensible reading of "share this out among things that
            # currently hold none".
            share = item.weight / absorbed if absorbed > 0 else Decimal(1) / Decimal(len(absorbers))
            rebalanced[item.identifier] = (available * share).quantize(
                WEIGHT_PLACES, rounding=ROUND_HALF_EVEN
            )
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


def _refuse_unless_the_locks_allow_it(
    items: list[WeightedItem], *, moved: str, to: Decimal
) -> None:
    """The four ways this move cannot be made, each naming what is actually in the way.

    Kept apart because the remedy differs: unlock the moved weight, unlock any sibling, unlock
    the particular siblings already holding the room, or -- for a pillar of one -- accept that
    no lock is involved and there is simply nothing to absorb a change. One sentence covering
    all four would send the user after a lock they cannot find, and `reqs.md` 3.4 asks the
    interface to say *which* locks block the change.
    """
    if next(item for item in items if item.identifier == moved).locked:
        raise WeightsAllLockedError(
            moved,
            (moved,),
            f"{moved} is itself locked. A lock holds that weight where it is, so unlock it "
            "before moving it.",
            kind="moved_is_locked",
        )

    siblings = [item for item in items if item.identifier != moved]
    if not siblings:
        raise WeightsAllLockedError(
            moved,
            (),
            f"{moved} is the only weight in the pillar, so it already holds all {TOTAL} of it "
            "and there is nothing to absorb a change.",
            kind="only_weight",
        )

    locked = tuple(item.identifier for item in siblings if item.locked)
    if len(locked) == len(siblings):
        raise WeightsAllLockedError(
            moved,
            locked,
            f"every other weight in the pillar is locked ({', '.join(locked)}). Unlock at "
            "least one, or change it instead.",
            kind="others_all_locked",
        )

    held = sum((item.weight for item in siblings if item.locked), Decimal(0))
    if to + held > TOTAL:
        raise WeightsAllLockedError(
            moved,
            locked,
            f"the locked weights ({', '.join(locked)}) hold {held} between them, which leaves "
            f"{TOTAL - held} for everything else and {to} does not fit. Unlock one of them, or "
            f"ask for at most {TOTAL - held}.",
            kind="locks_leave_no_room",
            held=held,
        )


def _corrected_for_rounding(
    rebalanced: dict[str, Decimal], absorbers: list[WeightedItem]
) -> dict[str, Decimal]:
    """Put any residue on the largest absorber.

    Proportional division of 100 rarely lands exactly -- three equal siblings give
    33.333... each. Each share is kept to `WEIGHT_PLACES` (reqs.md 5.1 still rounds for display
    only), and the remainder has to go somewhere for the sum to be exactly 100: the largest
    absorber is where it is least visible as a proportion of itself.
    """
    # Worked out exactly, never at the default 28 digits: the residue of shares kept to ten
    # places is itself a multiple of a ten-billionth, and a rounded sum would misplace it.
    with localcontext() as context:
        context.prec = EXACT
        residue = TOTAL - sum(rebalanced.values(), Decimal(0))
        if residue == 0 or not absorbers:
            return rebalanced
        largest = max(absorbers, key=lambda item: rebalanced[item.identifier])
        rebalanced[largest.identifier] += residue
    return rebalanced
