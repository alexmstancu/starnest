"""Turning stored values into scores, coverage and a ranking (`reqs.md` 5).

Pure functions over values and a `CriteriaSet`. No store, no clock, no network -- so every
rule here is unit-testable against figures written by hand, and none of it has to be re-proven
against a database. `import-linter` enforces the absence of a plugin import.

**Cut to what can run today** (`docs/mine2e.md` M1): `percentile` and `as_is` normalisation,
`minimise` and `maximise` goals, weight redistribution over the criteria that have a value,
coverage, and the weighted total. `fixed` interpolation, `target_range` falloff, the compound
rule shapes, match rules and evaluation snapshots are deliberately absent, and each is absent
for a reason the module that would hold it records.
"""

from starnest.evaluation.magnitudes import (
    PublishedFigure,
    UnscoreableValueError,
    figure_of,
    is_scoreable,
    magnitude_of,
)
from starnest.evaluation.normalisation import NormalisationError, scores_for
from starnest.evaluation.ranking import RankingError, rank_candidates
from starnest.evaluation.results import AttributeScore, CandidateResult, MatchStatus
from starnest.evaluation.store import EvaluationStore, SavedEvaluation, UnknownEvaluationError
from starnest.evaluation.weighting import (
    WeightingError,
    confidence_split,
    coverage_of,
    redistribute,
)

__all__ = [
    "AttributeScore",
    "CandidateResult",
    "EvaluationStore",
    "MatchStatus",
    "NormalisationError",
    "PublishedFigure",
    "RankingError",
    "SavedEvaluation",
    "UnknownEvaluationError",
    "UnscoreableValueError",
    "WeightingError",
    "confidence_split",
    "coverage_of",
    "figure_of",
    "is_scoreable",
    "magnitude_of",
    "rank_candidates",
    "redistribute",
    "scores_for",
]
