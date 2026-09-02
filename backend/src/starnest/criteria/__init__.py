"""What you make of what is measured.

The subjective half of the ontology (`reqs.md` 3.0). An `Attribute` says what is knowable; a
`Criterion` says whether more of it is better, how much it is worth, and where it stops being
acceptable. The same measured value scores differently under two criteria sets and neither is
wrong -- which is why a score belongs to an `Evaluation` and never to a candidate.

**This module decides what is wanted. It never measures, fetches or scores.** No values, no
normalisation, no totals and no ranking: all of those are `evaluation/`, which reads a
criteria set and applies it. A criterion says how to judge; it does not do the judging.

**How this module refuses things.** Every fault is a `ValueError` or a `LookupError`.
Constructing a `Criterion`, a `CriteriaSet` or a threshold goes through Pydantic, so a domain
error arrives wrapped in a `ValidationError` -- itself a `ValueError`, with the message intact
and the original recoverable from `error.errors()[0]["ctx"]["error"]`. `rebalance` and
`refuse_unless_it_suits` are not validators and raise their errors directly. Asking for a
criterion or a set that does not exist raises a `LookupError`, because that is a miss rather
than a malformed value.
"""

from starnest.criteria.criteria_set import (
    CriteriaSet,
    CriteriaSetError,
    PillarWeight,
    UnknownCriterionError,
)
from starnest.criteria.criterion import (
    Criterion,
    CriterionDeclarationError,
    Goal,
    NormalisationMethod,
    ReducerMode,
    ScaleAnchor,
)
from starnest.criteria.identifiers import CriteriaSetId
from starnest.criteria.rebalancing import (
    TOTAL,
    WeightedItem,
    WeightsAllLockedError,
    rebalance,
)
from starnest.criteria.store import CriteriaStore, UnknownCriteriaSetError
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
    "TOTAL",
    "BooleanThreshold",
    "CriteriaSet",
    "CriteriaSetError",
    "CriteriaSetId",
    "CriteriaStore",
    "Criterion",
    "CriterionDeclarationError",
    "Goal",
    "LabelThreshold",
    "MatchingThreshold",
    "NormalisationMethod",
    "PillarWeight",
    "RangeThreshold",
    "ReducerMode",
    "ScaleAnchor",
    "ShareThreshold",
    "ThresholdShapeError",
    "UnknownCriteriaSetError",
    "UnknownCriterionError",
    "WeightedItem",
    "WeightsAllLockedError",
    "rebalance",
]
