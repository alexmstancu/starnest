"""Weight rebalancing, including the cases that make it refuse.

This is the arithmetic behind the slider drag of arch.md 8.3, and the reason it lives on the
server: it depends on which weights are locked, and it must never leave a pillar summing to
anything but 100.
"""

from decimal import Decimal

import pytest

from starnest.criteria import WeightedItem, WeightsAllLockedError, rebalance


def item(identifier: str, weight: str, *, locked: bool = False) -> WeightedItem:
    return WeightedItem(identifier=identifier, weight=Decimal(weight), locked=locked)


def total(rebalanced: dict[str, Decimal]) -> Decimal:
    return sum(rebalanced.values(), Decimal(0))


def test_raising_one_weight_lowers_the_others_proportionally() -> None:
    """A sibling holding twice as much gives up twice as much, so the shape of what you
    already decided survives the change."""
    result = rebalance(
        [item("a", "20"), item("b", "40"), item("c", "40")], moved="a", to=Decimal("40")
    )

    assert result["a"] == Decimal("40")
    assert result["b"] == Decimal("30")
    assert result["c"] == Decimal("30")
    assert total(result) == Decimal("100")


def test_a_locked_sibling_keeps_its_weight_exactly() -> None:
    result = rebalance(
        [item("a", "20"), item("b", "30", locked=True), item("c", "50")],
        moved="a",
        to=Decimal("30"),
    )

    assert result["b"] == Decimal("30"), "a lock means this one does not move"
    assert result["a"] == Decimal("30")
    assert result["c"] == Decimal("40")
    assert total(result) == Decimal("100")


@pytest.mark.parametrize(
    "weights,to",
    [
        # Each of these leaves a residue that Decimal division cannot place exactly, which is
        # the case the rounding correction exists for. The first divides cleanly and is here as
        # the control: the correction must not disturb a total that is already exact.
        ((("a", "10"), ("b", "30"), ("c", "30"), ("d", "30")), "1"),
        ((("a", "10"), ("b", "20"), ("c", "30"), ("d", "40")), "15"),
        ((("a", "25"), ("b", "25"), ("c", "25"), ("d", "25")), "7"),
        ((("a", "1"), ("b", "33"), ("c", "33"), ("d", "33")), "13"),
    ],
)
def test_the_total_is_exactly_one_hundred_however_it_divides(
    weights: tuple[tuple[str, str], ...], to: str
) -> None:
    """Proportional division of 100 rarely lands exactly -- three equal siblings give
    33.333... each. Full precision is kept (reqs.md 5.1 rounds only at display) and the
    residue still has to go somewhere, or the pillar silently sums to 99.999 and every score
    computed from it is quietly wrong.
    """
    result = rebalance([item(i, w) for i, w in weights], moved="a", to=Decimal(to))

    assert total(result) == Decimal("100")
    assert result["a"] == Decimal(to), "the moved weight is exactly what was asked for"


def test_absorbers_at_zero_share_the_remainder_evenly() -> None:
    """Proportional sharing has nothing to go by when every absorber holds zero. Splitting
    evenly is the only reading of "share this among things that currently have none"."""
    result = rebalance(
        [item("a", "100"), item("b", "0"), item("c", "0")], moved="a", to=Decimal("40")
    )

    assert result["b"] == Decimal("30")
    assert result["c"] == Decimal("30")
    assert total(result) == Decimal("100")


def test_it_refuses_when_every_other_weight_is_locked() -> None:
    """The message names the locks. That message is why this check is in the domain at all,
    rather than left to a database constraint."""
    with pytest.raises(WeightsAllLockedError) as refused:
        rebalance(
            [item("a", "20"), item("b", "40", locked=True), item("c", "40", locked=True)],
            moved="a",
            to=Decimal("30"),
        )

    assert refused.value.locked == ("b", "c")
    assert "b, c" in str(refused.value)
    assert "unlock" in str(refused.value).lower()


def test_moving_a_weight_that_is_itself_locked_is_refused() -> None:
    """A lock is the user saying "not this one", and the one it was placed on is this one.

    Distinct from every situation below, which are all about the siblings having no room: here
    there is room, and the refusal is the lock doing exactly what it was set for.
    """
    with pytest.raises(WeightsAllLockedError) as refused:
        rebalance([item("a", "20", locked=True), item("b", "80")], moved="a", to=Decimal("60"))

    assert refused.value.locked == ("a",), "the lock in the way is the one on the moved weight"
    assert "itself locked" in str(refused.value)


def test_it_refuses_when_the_locks_leave_no_room() -> None:
    """An unlocked sibling exists, but the locked weights already claim more than what is left.

    Distinct from every-weight-locked, and it fails for the same reason: there is no
    arrangement that sums to 100. The message has to say so, because "every other weight is
    locked" would be false here -- `c` is unlocked, and telling the user to unlock it would
    send them after a lock that is not there.
    """
    with pytest.raises(WeightsAllLockedError) as refused:
        rebalance(
            [item("a", "10"), item("b", "80", locked=True), item("c", "10")],
            moved="a",
            to=Decimal("50"),
        )

    assert refused.value.locked == ("b",)
    assert "every other weight" not in str(refused.value)
    assert "b" in str(refused.value) and "80" in str(refused.value)


def test_a_single_weight_pillar_cannot_be_rebalanced() -> None:
    """One criterion in a pillar is already 100 percent of it. There is nothing to absorb a
    change, and pretending otherwise would silently leave the pillar wrong.

    No lock is involved, so the message must not name one -- there is nothing to unlock.
    """
    with pytest.raises(WeightsAllLockedError) as refused:
        rebalance([item("only", "100")], moved="only", to=Decimal("60"))

    assert refused.value.locked == ()
    assert "only weight in the pillar" in str(refused.value)
    assert "unlock" not in str(refused.value).lower()


@pytest.mark.parametrize("weight", ["-1", "101", "1000"])
def test_a_weight_outside_zero_to_one_hundred_is_refused(weight: str) -> None:
    """Percentages, 0-100 (reqs.md Q185)."""
    with pytest.raises(ValueError, match="percentage"):
        rebalance([item("a", "50"), item("b", "50")], moved="a", to=Decimal(weight))


def test_moving_a_weight_that_is_not_in_the_pillar_is_refused() -> None:
    with pytest.raises(ValueError, match="not one of these weights"):
        rebalance([item("a", "100")], moved="elsewhere", to=Decimal("50"))


def test_an_empty_pillar_is_refused() -> None:
    with pytest.raises(ValueError, match="nothing to rebalance"):
        rebalance([], moved="a", to=Decimal("50"))


def test_a_repeated_identifier_is_refused() -> None:
    """Two rows for one attribute would make the result ambiguous, and the schema's natural key
    forbids it anyway."""
    with pytest.raises(ValueError, match="twice"):
        rebalance([item("a", "50"), item("a", "50")], moved="a", to=Decimal("60"))


def test_setting_a_weight_to_zero_is_allowed() -> None:
    """Zero is a legitimate weight: the criterion still counts toward coverage, it just
    contributes nothing. Excluding it entirely is `is_scored`, which is a different act."""
    result = rebalance(
        [item("a", "20"), item("b", "40"), item("c", "40")], moved="a", to=Decimal("0")
    )

    assert result["a"] == Decimal("0")
    assert total(result) == Decimal("100")


def test_setting_one_weight_to_one_hundred_empties_the_others() -> None:
    result = rebalance(
        [item("a", "20"), item("b", "40"), item("c", "40")], moved="a", to=Decimal("100")
    )

    assert result["b"] == Decimal("0")
    assert result["c"] == Decimal("0")
    assert total(result) == Decimal("100")
