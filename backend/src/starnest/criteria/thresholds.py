"""Matching thresholds, and the value types each may apply to.

A threshold is what makes a criterion able to say `not_matching` rather than merely score low
(reqs.md 5.2). Four shapes, and which one is legal is decided by the attribute's value type --
a `LabelSet` cannot be given a numeric range, and a `Monetary` cannot be given a containment
rule.

**The schema enforces exactly this, and so does this module.** Each threshold child table
carries the criterion's `value_type` and pins it with a CHECK, joined by the composite key of
arch.md 3.3b. The duplication is deliberate: the database is authoritative, and the domain
check exists where a good message is worth producing before the constraint fires.
"""

from abc import ABC, abstractmethod
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, model_validator

from starnest.data import ValueType


class ThresholdShapeError(ValueError):
    """A threshold that cannot apply to the attribute it was written for."""


class MatchingThreshold(BaseModel, ABC):
    """One shape of threshold. Frozen, like everything else that describes a decision."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    @property
    @abstractmethod
    def applicable_value_types(self) -> frozenset[ValueType]:
        """The value types this shape may judge. Mirrors the child table's CHECK."""

    def refuse_unless_it_suits(self, value_type: ValueType) -> None:
        """Raise unless this shape may judge that type, naming what would have been legal."""
        if value_type not in self.applicable_value_types:
            legal = ", ".join(sorted(self.applicable_value_types))
            raise ThresholdShapeError(
                f"a {type(self).__name__} cannot judge a {value_type} attribute; "
                f"this shape applies to: {legal}"
            )


# The six numeric types, named once. reqs.md 3.3a: a range is meaningful wherever the value is
# a number on a scale, and meaningless where it is a label, a set of shares, or free text.
NUMERIC_TYPES = frozenset(
    {
        ValueType.MONETARY,
        ValueType.QUANTITY,
        ValueType.COUNT,
        ValueType.RATIO,
        ValueType.INDEX,
        ValueType.ASSIGNED_SCORE,
    }
)


class RangeThreshold(MatchingThreshold):
    """A candidate matches while the value stays inside the band.

    At least one bound is required -- a range open at both ends excludes nothing and is more
    likely a mistake than an intention.
    """

    min_value: Decimal | None = None
    max_value: Decimal | None = None

    @property
    def applicable_value_types(self) -> frozenset[ValueType]:
        return NUMERIC_TYPES

    @model_validator(mode="after")
    def _declares_an_ordered_bound(self) -> "RangeThreshold":
        if self.min_value is None and self.max_value is None:
            raise ThresholdShapeError(
                "a range threshold needs a minimum, a maximum, or both; "
                "one open at both ends excludes nothing"
            )
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise ThresholdShapeError(f"minimum {self.min_value} is above maximum {self.max_value}")
        return self


class LabelThreshold(MatchingThreshold):
    """A candidate matches on whether a label is present, or absent.

    `must_not_contain` is not redundant with `must_contain`: "not tropical" is a different
    statement from "temperate", because a LabelSet may carry several labels at once.
    """

    label: str
    containment_rule: str

    @property
    def applicable_value_types(self) -> frozenset[ValueType]:
        return frozenset({ValueType.LABEL_SET})

    @model_validator(mode="after")
    def _rule_is_known(self) -> "LabelThreshold":
        if self.containment_rule not in {"must_contain", "must_not_contain"}:
            raise ThresholdShapeError(
                f"unknown containment rule {self.containment_rule!r}; "
                "expected must_contain or must_not_contain"
            )
        if not self.label.strip():
            raise ThresholdShapeError("a label threshold needs a label")
        return self


class BooleanThreshold(MatchingThreshold):
    """A candidate matches when the answer is the one required."""

    required_value: bool

    @property
    def applicable_value_types(self) -> frozenset[ValueType]:
        return frozenset({ValueType.BOOLEAN})


class ShareThreshold(MatchingThreshold):
    """One slice of a composition must stay within bounds.

    Shares are percentages, 0-100 (reqs.md Q185), like every other proportion in the system.
    """

    label: str
    min_share: Decimal | None = None
    max_share: Decimal | None = None

    @property
    def applicable_value_types(self) -> frozenset[ValueType]:
        return frozenset({ValueType.SHARE_COMPOSITION})

    @model_validator(mode="after")
    def _declares_an_ordered_bound(self) -> "ShareThreshold":
        if not self.label.strip():
            raise ThresholdShapeError("a share threshold needs the label of the slice it bounds")
        if self.min_share is None and self.max_share is None:
            raise ThresholdShapeError("a share threshold needs a minimum, a maximum, or both")
        for name, share in (("min_share", self.min_share), ("max_share", self.max_share)):
            if share is not None and not (0 <= share <= 100):
                raise ThresholdShapeError(f"{name} is a percentage 0-100, not {share}")
        if (
            self.min_share is not None
            and self.max_share is not None
            and self.min_share > self.max_share
        ):
            raise ThresholdShapeError(
                f"minimum share {self.min_share} is above maximum {self.max_share}"
            )
        return self
