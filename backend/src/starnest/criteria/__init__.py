"""What you make of what is measured.

The subjective half of the ontology (reqs.md 3.0). An `Attribute` says what is knowable; a
`Criterion` says whether more of it is better, how much it is worth, and where it stops being
acceptable. The same measured value scores differently under two criteria sets, and neither is
wrong -- which is why score belongs to an `Evaluation` and never to a candidate.

**This module decides what is wanted, never what is measured, and never what the answer is.**
No fetching, no values, no scoring arithmetic: normalisation and totals are `evaluation/`. A
criterion says how to judge; it does not judge.
"""

from starnest.criteria.rebalancing import (
    WeightedItem,
    WeightsAllLockedError,
    rebalance,
)
from starnest.criteria.thresholds import (
    NUMERIC_TYPES,
    BooleanThreshold,
    LabelThreshold,
    MatchingThreshold,
    RangeThreshold,
    ShareThreshold,
    ThresholdShapeError,
)

__all__ = [
    "NUMERIC_TYPES",
    "BooleanThreshold",
    "LabelThreshold",
    "MatchingThreshold",
    "RangeThreshold",
    "ShareThreshold",
    "ThresholdShapeError",
    "WeightedItem",
    "WeightsAllLockedError",
    "rebalance",
]
