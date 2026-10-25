"""Turning stored values into scores, coverage and a ranking (`reqs.md` 5).

Pure functions over values and a `CriteriaSet`. No store, no clock, no network -- so every
rule here is unit-testable against figures written by hand, and none of it has to be re-proven
against a database. `import-linter` enforces the absence of a plugin import, and
`tests/unit/test_architecture.py` the absence of a clock read: which figures have aged is the
caller's to say, from the active-value view (PL-064).

**What is here** (`reqs.md` 5): `fixed`, `percentile` and `as_is` normalisation, the three goals
with `target_range`'s falloff, weight redistribution over the criteria that have a value,
coverage and its split by confidence, the weighted total and the rank -- and who matches: an
enforced gate answered `not_matching`, a decided compound rule, and a figure past a criterion's
matching threshold, judged on every criterion at the level whether it is scored or not (BE-01).
Keeping an evaluation is a seam declared here (`store.py`) and implemented by `storage/`;
`parent_not_matching` belongs to the city level and is not here yet.
"""

from starnest.evaluation.magnitudes import (
    PublishedFigure,
    UnscoreableValueError,
    figure_of,
    is_scoreable,
    magnitude_of,
)
from starnest.evaluation.normalisation import NormalisationError, scores_for
from starnest.evaluation.ranking import (
    RankingError,
    against_home,
    declared_weights,
    in_display_order,
    rank_candidates,
)
from starnest.evaluation.results import AttributeScore, CandidateResult, MatchStatus
from starnest.evaluation.rules import (
    NonMatch,
    RuleWarning,
    describe_compound_rule,
    gates_that_rule_out,
    gates_that_warn,
    judgements_of,
    thresholds_that_rule_out,
)
from starnest.evaluation.store import (
    EvaluationStore,
    SavedEvaluation,
    UnknownEvaluationError,
    UnsavableEvidenceError,
)
from starnest.evaluation.weighting import (
    WeightingError,
    confidence_split,
    contribution_of,
    coverage_of,
    redistribute,
    renormalise,
)

__all__ = [
    "AttributeScore",
    "CandidateResult",
    "EvaluationStore",
    "MatchStatus",
    "NonMatch",
    "NormalisationError",
    "PublishedFigure",
    "RankingError",
    "RuleWarning",
    "SavedEvaluation",
    "UnknownEvaluationError",
    "UnsavableEvidenceError",
    "UnscoreableValueError",
    "WeightingError",
    "against_home",
    "confidence_split",
    "contribution_of",
    "coverage_of",
    "declared_weights",
    "describe_compound_rule",
    "figure_of",
    "gates_that_rule_out",
    "gates_that_warn",
    "in_display_order",
    "is_scoreable",
    "judgements_of",
    "magnitude_of",
    "rank_candidates",
    "redistribute",
    "renormalise",
    "scores_for",
    "thresholds_that_rule_out",
]
