"""Which threshold shapes may judge which value types, and what each refuses.

**The error contract, which the assertions below depend on.** Constructing a threshold goes
through Pydantic, so a domain error surfaces wrapped in `ValidationError` -- itself a
`ValueError`, with the message intact and the original recoverable from
`err.errors()[0]["ctx"]["error"]`. `refuse_unless_it_suits` is not a validator, so it raises
`ThresholdShapeError` directly. Both are `ValueError`, which is the house contract.


The pairing is enforced twice on purpose (arch.md 3.3b): the schema's composite key makes a
wrong pairing impossible to insert, and this makes it impossible to construct -- with a message
worth reading before the constraint fires.
"""

from decimal import Decimal

import pytest

from starnest.criteria import (
    NUMERIC_TYPES,
    BooleanThreshold,
    LabelThreshold,
    RangeThreshold,
    ShareThreshold,
    ThresholdShapeError,
)
from starnest.data import ValueType

EVERY_TYPE = frozenset(ValueType)


def test_a_range_judges_every_numeric_type_and_nothing_else() -> None:
    """Mirrors `criterion_threshold_range_suits_its_type` exactly. A drift between the two
    would let the domain accept what the database then refuses."""
    threshold = RangeThreshold(max_value=Decimal("100"))

    assert threshold.applicable_value_types == NUMERIC_TYPES
    for value_type in NUMERIC_TYPES:
        threshold.refuse_unless_it_suits(value_type)


@pytest.mark.parametrize(
    "value_type",
    sorted(EVERY_TYPE - NUMERIC_TYPES),
)
def test_a_range_refuses_every_non_numeric_type(value_type: ValueType) -> None:
    """A band on a climate zone or a set of shares is meaningless, not merely unusual."""
    with pytest.raises(ThresholdShapeError, match="cannot judge"):
        RangeThreshold(min_value=Decimal("1")).refuse_unless_it_suits(value_type)


def test_the_refusal_names_what_would_have_been_legal() -> None:
    """The point of checking here rather than only in the database."""
    with pytest.raises(ThresholdShapeError) as refused:
        RangeThreshold(min_value=Decimal("1")).refuse_unless_it_suits(ValueType.LABEL_SET)

    assert "LabelSet" in str(refused.value)
    assert "Monetary" in str(refused.value), "it should say which types this shape does judge"


def test_a_range_open_at_both_ends_is_refused() -> None:
    """It excludes nothing, so it is more likely a mistake than an intention."""
    with pytest.raises(ValueError, match="excludes nothing"):
        RangeThreshold()


def test_an_inverted_range_is_refused() -> None:
    with pytest.raises(ValueError, match="above maximum"):
        RangeThreshold(min_value=Decimal("100"), max_value=Decimal("10"))


def test_a_label_threshold_only_judges_a_labelset() -> None:
    threshold = LabelThreshold(label="temperate", containment_rule="must_contain")

    threshold.refuse_unless_it_suits(ValueType.LABEL_SET)
    with pytest.raises(ThresholdShapeError):
        threshold.refuse_unless_it_suits(ValueType.MONETARY)


def test_must_not_contain_is_a_separate_statement_from_must_contain() -> None:
    """Not redundant: a LabelSet carries several labels at once, so "not tropical" and
    "temperate" are different questions with different answers."""
    excluded = LabelThreshold(label="tropical", containment_rule="must_not_contain")
    required = LabelThreshold(label="temperate", containment_rule="must_contain")

    assert excluded != required
    assert excluded.containment_rule != required.containment_rule


@pytest.mark.parametrize("rule", ["contains", "MUST_CONTAIN", "", "excludes"])
def test_an_unknown_containment_rule_is_refused(rule: str) -> None:
    with pytest.raises(ValueError, match="containment rule"):
        LabelThreshold(label="temperate", containment_rule=rule)


@pytest.mark.parametrize("label", ["", "   "])
def test_a_label_threshold_needs_a_label(label: str) -> None:
    with pytest.raises(ValueError, match="needs a label"):
        LabelThreshold(label=label, containment_rule="must_contain")


def test_a_boolean_threshold_only_judges_a_boolean() -> None:
    threshold = BooleanThreshold(required_value=True)

    threshold.refuse_unless_it_suits(ValueType.BOOLEAN)
    with pytest.raises(ThresholdShapeError):
        threshold.refuse_unless_it_suits(ValueType.COUNT)


def test_a_share_threshold_only_judges_a_composition() -> None:
    threshold = ShareThreshold(label="renewables", min_share=Decimal("30"))

    threshold.refuse_unless_it_suits(ValueType.SHARE_COMPOSITION)
    with pytest.raises(ThresholdShapeError):
        threshold.refuse_unless_it_suits(ValueType.RATIO)


@pytest.mark.parametrize("share", ["-1", "101"])
def test_a_share_outside_zero_to_one_hundred_is_refused(share: str) -> None:
    """Shares are percentages like every other proportion here (reqs.md Q185)."""
    with pytest.raises(ValueError, match="percentage"):
        ShareThreshold(label="renewables", min_share=Decimal(share))


def test_a_share_threshold_with_no_bound_is_refused() -> None:
    with pytest.raises(ValueError, match="minimum, a maximum, or both"):
        ShareThreshold(label="renewables")


def test_an_inverted_share_range_is_refused() -> None:
    with pytest.raises(ValueError, match="above maximum"):
        ShareThreshold(label="coal", min_share=Decimal("80"), max_share=Decimal("20"))


def test_a_share_threshold_needs_the_slice_it_bounds() -> None:
    with pytest.raises(ValueError, match="label of the slice"):
        ShareThreshold(label="  ", min_share=Decimal("10"))


def test_thresholds_are_frozen() -> None:
    """A threshold is a decision, and decisions are recorded rather than mutated."""
    threshold = RangeThreshold(max_value=Decimal("100"))

    with pytest.raises(ValueError):
        threshold.max_value = Decimal("50")


def test_every_value_type_is_judged_by_at_most_one_shape() -> None:
    """Exactly one kind of threshold may apply to a criterion, which is why the schema gives
    each its own child table keyed on the criterion. Two shapes claiming one type would make
    that ambiguous.

    Text is deliberately judged by none: a matching threshold on free prose would be a rule
    nobody could state precisely.
    """
    shapes = [
        RangeThreshold(min_value=Decimal("1")),
        LabelThreshold(label="x", containment_rule="must_contain"),
        BooleanThreshold(required_value=True),
        ShareThreshold(label="x", min_share=Decimal("1")),
    ]

    for value_type in ValueType:
        claimants = [s for s in shapes if value_type in s.applicable_value_types]
        assert len(claimants) <= 1, f"{value_type} is claimed by {len(claimants)} shapes"

    assert not [s for s in shapes if ValueType.TEXT in s.applicable_value_types]
