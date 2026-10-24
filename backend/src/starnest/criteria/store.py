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
criteria set is an opinion the user wrote and may withdraw -- and take back: a deleted set keeps
every row it owns, every read and edit sees live sets only, and only the purge, for tests and
tooling, destroys one (PL-033). A saved evaluation froze its own copy (`reqs.md` Q193) anyway.

**`MatchRuleResultStore` is here too** (`arch.md` 6.3), because whether a gate's answer counts
is a criteria set's preference -- and the module that holds the preference is the one that
decides to read the answer. The answer itself (`data.MatchRuleResult`) is a finding about a
candidate, modelled where findings are.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import NamedTuple

from starnest.criteria.criteria_set import CriteriaSet
from starnest.criteria.identifiers import CriteriaSetId
from starnest.data import AttributeId, MatchRuleResult
from starnest.household import Settings


class CriteriaSetExistsError(ValueError):
    """A set is being created under an identifier something already holds, live or deleted.

    Refused rather than overwritten. Silently replacing a set somebody built is the worst kind
    of success: the weights they chose are gone, nothing said so, and the ranking simply reads
    differently the next time they look.
    """


class CriteriaSetNameTakenError(CriteriaSetExistsError):
    """A set would share its name with another live set, ignoring case and surrounding spaces.

    A name is how a person tells two sets apart (PL-036). A deleted set holds no name, so another
    may take it -- and restoring the first is then refused rather than renaming either, which
    would be choosing a name nobody picked (P1-35).

    A kind of `CriteriaSetExistsError`: either way a set already holds what this one would.
    """

    def __init__(self, name: str, refused: str) -> None:
        super().__init__(
            f"{refused}: another live criteria set is already called {name!r}, ignoring case "
            "and surrounding spaces"
        )
        self.name = name
        self.details = {"name": name}


class UnknownCriteriaSetError(LookupError):
    """A criteria set was asked for that does not exist.

    A `LookupError` rather than a `ValueError`: the identifier is well formed, there is simply
    no such set. The distinction is what lets the API map one to 404 and the other to 400.
    """


class NoDefaultCriteriaSetError(LookupError):
    """No set is the default, so a new set has nothing to copy (P1-29).

    Refused rather than made empty: an empty set scores nothing, and nothing can fill it.
    """


class CriteriaSetInUseError(ValueError):
    """A criteria set cannot be purged while a saved evaluation names it (P60).

    **A saved evaluation is a measurement and the set is an opinion**, but the evaluation keeps
    the set's identifier to say which opinion it was measuring (`reqs.md` Q193), so purging the
    set would leave a snapshot naming nothing. Refused rather than cascaded: deleting
    somebody's kept rankings as a side effect of tidying up a criteria set is not a tidy-up.
    Deleting such a set in place is not refused: the row the evaluation names stays.

    Only the purge raises it, and no route purges, so no response carries it (PL-035).
    """


class HighestAnchor(NamedTuple):
    """The highest score any live set anchors a figure to, and where: the least a range can be."""

    score: int
    criteria_set: CriteriaSetId
    attribute: AttributeId


class CriteriaStore(ABC):
    """Read and write criteria sets, their criteria, their anchors and their weights."""

    @abstractmethod
    async def read_criteria_set_summaries(self) -> tuple[tuple[CriteriaSetId, str], ...]:
        """Every live set's identifier and name, for the switcher the sidebar shows everywhere.

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

        Raises `UnknownCriteriaSetError` when there is no such set, or it has been deleted.
        """

    @abstractmethod
    async def read_default_criteria_set(self) -> CriteriaSet:
        """The set a new one copies (P1-29), whole -- even once it has been deleted.

        Raises `NoDefaultCriteriaSetError` when no set is the default.
        """

    @abstractmethod
    async def create_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Store a set whole -- the set row, every criterion, every anchor and threshold.

        One transaction, for the reason in this module's docstring. This is also how
        duplication is persisted: `CriteriaSet.duplicated_as` produces the copy and this
        writes it, so there is no separate "duplicate" operation to keep in step with the
        rules about what a copy contains.

        Raises `CriteriaSetExistsError` when the identifier is held by any set, deleted ones
        included, and `CriteriaSetNameTakenError` when another live set has the name.
        """

    @abstractmethod
    async def replace_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Overwrite an existing live set with this one, criteria and weights together.

        Raises `UnknownCriteriaSetError` when there is nothing to replace -- a replacement that
        waited on a deletion included. Creating instead would turn a mistyped identifier into a
        new set nobody asked for, which is the kind of success that is worse than a failure.
        """

    @abstractmethod
    async def edit_criteria_set(
        self,
        criteria_set: CriteriaSetId | str,
        mutate: Callable[[CriteriaSet], CriteriaSet],
    ) -> CriteriaSet:
        """Read the set, apply `mutate`, and write the result as one locked transaction.

        The whole read-modify-write of a set belongs to one request on the server -- read the
        set, ask the domain for the changed one, write it back whole -- so two overlapping edits
        must serialise, or the later one silently restores what the earlier turned off (ST-02).
        The implementation holds a lock across the read and the write; `mutate` is the caller's
        own rebalance, rename or toggle, and a refusal it raises rolls the edit back. Returns the
        set as written, which is what the response is built from.

        Live sets only: `UnknownCriteriaSetError` for a deleted one, and for an edit that waited
        on a deletion. A rename to another live set's name raises `CriteriaSetNameTakenError`.
        """

    @abstractmethod
    async def edit_criteria_set_under_the_score_scale(
        self,
        criteria_set: CriteriaSetId | str,
        mutate: Callable[[CriteriaSet, int | None], CriteriaSet],
    ) -> CriteriaSet:
        """`edit_criteria_set`, with the score range `mutate` checks anchors against held too.

        **The range is read inside the edit, and held until it commits** (PL-006), so it cannot
        change between the check and the write: a range being changed waits for the edit, and
        then meets the anchors it wrote -- see `replace_settings_over_the_anchors`. `None` when
        no range is set.
        """

    @abstractmethod
    async def replace_settings_over_the_anchors(
        self,
        settings: Settings,
        refuse: Callable[[Settings, HighestAnchor | None], None],
    ) -> None:
        """Store the settings whole, unless `refuse` raises over the stored ones and the anchors.

        **One transaction, holding the settings against every anchor edit** (PL-006): `refuse`
        sees the settings as stored and the highest anchor as it stands, and nothing can anchor
        higher before the new range commits. Here rather than on `HouseholdStore` because the
        anchors are a criteria set's, and `household/` knows nothing of them.
        """

    @abstractmethod
    async def discard_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        """Delete a live set in place: every row it owns stays, so it can be restored exactly.

        Raises `UnknownCriteriaSetError` when there is no live set by that identifier, so a
        second deletion is reported rather than silently succeeding.
        """

    @abstractmethod
    async def restore_criteria_set(self, criteria_set: CriteriaSetId | str) -> CriteriaSet:
        """Bring a deleted set back exactly as it was deleted, and return it.

        Idempotent on a live set. Raises `UnknownCriteriaSetError` when no set ever held the
        identifier, and `CriteriaSetNameTakenError` when another live set took its name while it
        was deleted (P1-35) -- it then stays deleted.
        """

    @abstractmethod
    async def purge_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        """Destroy a set, live or deleted, and every row it owns. For tests and tooling only.

        Raises `UnknownCriteriaSetError` when there is no such set, and `CriteriaSetInUseError`
        while a saved evaluation names it.
        """


class MatchRuleResultStore(ABC):
    """Each gate's answer for each candidate, with the pages it was read from and any override.

    **One live answer per gate per candidate**: recording replaces it, because a gate is
    re-checked rather than accumulated -- and keeps the answer it replaced as an immutable
    version, so a correction never destroys what it corrects and a saved refusal can pin the
    version it read (`reqs.md` Q237). An override is a reason and the moment it was given, and
    travels with the answer everywhere it is shown (`reqs.md` 3.7).
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
    async def record(self, result: MatchRuleResult) -> bool:
        """Store one answer with its citations, replacing the previous answer and its pages.

        Answers whether it was stored. **A model's answer never replaces one a person recorded**
        (`reqs.md` 6.10 use 3, NEW-02), so that one is declined and this answers `False` -- for
        the caller to report: the endpoint that takes an answer refuses it (NEW-36), and a
        research pass names it among its refusals rather than its proposals (NEW-63).
        """
