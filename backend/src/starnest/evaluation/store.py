"""The persistence seam this module declares: a ranking somebody chose to keep.

`arch.md` 6.3, `reqs.md` 3.4a and Q155. **Reading a ranking stores nothing** -- adjusting a
weight recalculates in memory, and an afternoon of tuning would otherwise bury the few results
that mattered under hundreds nobody asked for. A row here is one that was deliberately kept.

**What is kept is the ranking *and* the criteria that produced it** (Q156). The criteria set
stays editable afterwards, so a saved evaluation that pointed at it would change meaning the
next time a weight moved. The snapshot freezes the weights, the goals, the bands, the anchors,
the score scale and which attributes were in scope -- that last one being what keeps a coverage
figure meaningful after the catalog grows.
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from starnest.criteria import CriteriaSet
from starnest.evaluation.results import CandidateResult


class UnknownEvaluationError(LookupError):
    """No evaluation has that identifier."""


@dataclass(frozen=True)
class SavedEvaluation:
    """The header of a kept ranking: what was run, when, on which scale, and why it was kept."""

    id: int
    criteria_set: str
    level: str
    computed_at: datetime
    score_scale_max: int
    note: str | None = None


class EvaluationStore(ABC):
    """Keep a ranking, and read back exactly what was kept."""

    @abstractmethod
    async def save(
        self,
        *,
        criteria: CriteriaSet,
        level: str,
        results: Sequence[CandidateResult],
        score_scale_max: int,
        computed_at: datetime,
        note: str | None = None,
    ) -> SavedEvaluation:
        """Write the ranking, its per-attribute detail and a frozen copy of the criteria.

        One transaction: a ranking whose criteria snapshot is missing would read as a set of
        numbers nobody could account for, which is the opposite of why it was kept.
        """

    @abstractmethod
    async def read_evaluations(self) -> tuple[SavedEvaluation, ...]:
        """Every kept evaluation, newest first."""

    @abstractmethod
    async def read_evaluation(self, evaluation: int) -> SavedEvaluation:
        """One header. Raises `UnknownEvaluationError`."""

    @abstractmethod
    async def read_results(self, evaluation: int) -> tuple[CandidateResult, ...]:
        """The ranking as it was kept, in its own order, non-matching candidates included."""

    @abstractmethod
    async def read_criteria(self, evaluation: int) -> CriteriaSet:
        """The frozen criteria, as a criteria set: weights, goals, bands, anchors, scope."""

    @abstractmethod
    async def read_candidate(self, evaluation: int, candidate: str) -> CandidateResult:
        """One candidate with its per-attribute detail: the drill-down behind a total."""
