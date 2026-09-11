"""The persistence seam this module declares (`arch.md` 6.3), implemented in `storage`.

The interface is declared by the module that *needs* it, so the arrow of dependency runs
opposite to the arrow of control and no policy module ever names a concrete implementation.

**A criteria set is read and written whole.** It spans five tables -- the set, its criteria,
their anchors, their thresholds, and its two rule-enforcement lists -- and the invariant that
matters belongs to none of them individually: weights sum to 100 within a pillar and within a
level. A half-written set sums to less than 100, and a ranking computed from it is quietly
wrong rather than absent, which is the worse of the two failures.

**This store has a delete, and `ValueStore` deliberately does not.** Not an inconsistency: a
value is evidence, and deleting one would destroy a measurement that may be unrepeatable. A
criteria set is an opinion the user wrote and may withdraw. Nothing depends on an opinion
having been held -- a saved evaluation froze its own copy for exactly this reason
(`reqs.md` Q193), so deleting the set it came from leaves the evaluation still readable.

**`MatchRuleResultStore` is here too** (`arch.md` 6.3), because whether a gate's answer counts
is a criteria set's preference -- and the module that holds the preference is the one that
decides to read the answer. The answer itself (`data.MatchRuleResult`) is a finding about a
candidate, modelled where findings are.
"""

from abc import ABC, abstractmethod

from starnest.criteria.criteria_set import CriteriaSet
from starnest.criteria.identifiers import CriteriaSetId
from starnest.data import MatchRuleResult


class CriteriaSetExistsError(ValueError):
    """A set is being created under an identifier something already holds.

    Refused rather than overwritten. Silently replacing a set somebody built is the worst kind
    of success: the weights they chose are gone, nothing said so, and the ranking simply reads
    differently the next time they look.
    """


class UnknownCriteriaSetError(LookupError):
    """A criteria set was asked for that does not exist.

    A `LookupError` rather than a `ValueError`: the identifier is well formed, there is simply
    no such set. The distinction is what lets the API map one to 404 and the other to 400.
    """


class CriteriaStore(ABC):
    """Read and write criteria sets, their criteria, their anchors and their weights."""

    @abstractmethod
    async def read_criteria_set_summaries(self) -> tuple[tuple[CriteriaSetId, str], ...]:
        """Every set's identifier and name, for the switcher the sidebar shows everywhere.

        Summaries rather than whole sets. The switcher displays names; reading 41 criteria
        with their anchors and thresholds for each set to populate a dropdown would make the
        most frequently rendered element in the product the most expensive one.
        """

    @abstractmethod
    async def read_criteria_set(
        self, criteria_set: CriteriaSetId | str, *, level: str | None = None
    ) -> CriteriaSet:
        """One whole set: criteria, anchors, thresholds, pillar weights, enforced rules.

        `level` narrows the criteria and the pillar weights **together**, never one without
        the other. Weights sum to 100 within a level, so a read that narrowed only the
        criteria would return a set whose pillar weights summed to 200 -- and the domain
        would refuse to construct it, which is the right outcome reached the wrong way.

        Pass `None` for the set entire, which is what the criteria screen shows.

        Raises `UnknownCriteriaSetError` when there is no such set.
        """

    @abstractmethod
    async def create_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Store a set whole -- the set row, every criterion, every anchor and threshold.

        One transaction, for the reason in this module's docstring. This is also how
        duplication is persisted: `CriteriaSet.duplicated_as` produces the copy and this
        writes it, so there is no separate "duplicate" operation to keep in step with the
        rules about what a copy contains.
        """

    @abstractmethod
    async def replace_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Overwrite an existing set with this one, criteria and weights together.

        Raises `UnknownCriteriaSetError` when there is nothing to replace. Creating instead
        would turn a mistyped identifier into a new set nobody asked for, which is the kind
        of success that is worse than a failure.
        """

    @abstractmethod
    async def delete_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        """Remove a set and everything hanging off it.

        Raises `UnknownCriteriaSetError` when there is no such set, so a second delete is
        reported rather than silently succeeding.
        """


class MatchRuleResultStore(ABC):
    """Each gate's answer for each candidate, with the pages it was read from and any override.

    **One answer per gate per candidate**: recording replaces, because a gate is re-checked
    rather than accumulated. An override is a reason and the moment it was given, and travels
    with the answer everywhere it is shown (`reqs.md` 3.7).
    """

    @abstractmethod
    async def read_results(
        self,
        *,
        candidate: str | None = None,
        match_rule: str | None = None,
        level: str | None = None,
    ) -> tuple[MatchRuleResult, ...]:
        """Every answer the filters allow; each narrows independently."""

    @abstractmethod
    async def record(self, result: MatchRuleResult) -> None:
        """Store one answer with its citations, replacing the previous answer and its pages."""
