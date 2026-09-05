"""The two persistence seams this module declares (`arch.md` 6.3), implemented in `storage`.

The interface is declared by the module that *needs* it, so the arrow of dependency runs
opposite to the arrow of control and no policy module ever names a concrete implementation.

**One store per module, never one per table.** `data` owns values, external scores and the
objective catalog, and declares two interfaces for all of it -- split by what a caller is
doing rather than by which table answers. A module receives only the operations it actually
calls, so nothing that reads a catalog can accidentally write a value.

**Neither interface has an update or a delete, and that is the invariant rather than an
oversight.** Values are never overwritten and never discarded (`reqs.md` 3.6); catalog rows
are changed only by migration (`arch.md` 1.2). An implementation that offered either would be
implementing something this module did not ask for.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence

from starnest.candidates import LevelHierarchy
from starnest.data.attribute import Attribute, Pillar
from starnest.data.external_score import ExternalScore
from starnest.data.identifiers import (
    AttributeId,
    BreakdownOptionId,
    BreakdownSchemeId,
)
from starnest.data.rules import CompoundRule, MatchRule
from starnest.data.sources import DataSource
from starnest.data.value import Value, ValueListing


class UnknownAttributeError(LookupError):
    """An attribute was asked for that the catalog does not contain."""


class ValueStore(ABC):
    """Read the values behind a score, and append new ones.

    "Active" is not a stored column anywhere -- `read_active_values` returns what the rule of
    `arch.md` 4 chooses, evaluated at read time.
    """

    @abstractmethod
    async def read_active_values(
        self,
        *,
        level: str | None = None,
        candidates: Sequence[str] = (),
        attributes: Sequence[str] = (),
    ) -> tuple[Value, ...]:
        """The value scoring would use, for every candidate and attribute asked for.

        All three filters are optional and narrow independently: a whole level for the
        ranking, a set of candidates for a comparison, a set of attributes for the ones a
        criteria set actually judges. One call rather than one per candidate -- a slider drag
        recomputes a ranking, and the shape of this read is what decides whether that feels
        instant.

        Every breakdown option comes back. Reducing several options to the one that applies
        is a criterion's choice, made when the score is computed and never here.
        """

    @abstractmethod
    async def read_values(
        self,
        *,
        candidate: str | None = None,
        attribute: str | None = None,
        include_superseded: bool = True,
        limit: int | None = None,
        offset: int = 0,
    ) -> tuple[ValueListing, ...]:
        """Every stored value, superseded and rejected ones included, for the drill-down.

        Nothing is discarded, and the point of the screen is to show that: the figure that
        lost, the figure that was rejected and why, and the one being used, together.

        **Each comes back paired with whether it is the active one**, because "the one being
        used" is the only part of that sentence a caller cannot work out from the values
        themselves -- it depends on the attribute's `max_age` and the source priority, both of
        which live elsewhere. `ValueListing` carries the pair rather than `Value` growing a
        field, for the reason set out there.
        """

    @abstractmethod
    async def count_values(
        self,
        *,
        candidate: str | None = None,
        attribute: str | None = None,
        include_superseded: bool = True,
    ) -> int:
        """How many values `read_values` would return unpaginated."""

    @abstractmethod
    async def append(self, values: Sequence[Value]) -> tuple[Value, ...]:
        """Store values as they are, and return them carrying the identifiers they were given.

        Append, never update: a correction is a new value that supersedes the old one through
        the active-value rule, and a value that failed validation is stored already carrying
        its `rejection_reason` rather than updated into rejection later.
        """

    @abstractmethod
    async def read_external_scores(
        self, *, candidate: str | None = None, level: str | None = None
    ) -> tuple[ExternalScore, ...]:
        """What outside indices published about these candidates.

        Separate from every other read here, and it must stay that way: an external score is
        displayed beside our score and never enters it (`reqs.md` 3.5a).
        """

    @abstractmethod
    async def append_external_score(self, score: ExternalScore) -> ExternalScore:
        """Store one published figure, returning it with the identifier it was given."""


class CatalogStore(ABC):
    """Read the objective catalog: levels, pillars, attributes, sources, breakdown schemes.

    All of it is changed only by migration, so there is nothing here that writes. An admin
    screen would need one -- and `reqs.md` 2 says deliberately that there is no admin screen.
    """

    @abstractmethod
    async def read_levels(self) -> LevelHierarchy:
        """The levels, ordered and validated as a single containment chain.

        The whole hierarchy rather than a list, because every caller that wants the levels
        wants to ask something of them -- which is widest, what nests in what -- and a list
        would make each caller re-derive it.
        """

    @abstractmethod
    async def read_pillars(self) -> tuple[Pillar, ...]:
        """The verticals attributes are grouped into."""

    @abstractmethod
    async def read_attributes(
        self, *, level: str | None = None, include_retired: bool = False
    ) -> tuple[Attribute, ...]:
        """The catalog, with every per-attribute declaration attached.

        Retired attributes are excluded by default: they keep their stored values but drop
        out of scoring, so a caller that wants them has to say so.
        """

    @abstractmethod
    async def read_attribute(self, attribute_id: AttributeId | str) -> Attribute:
        """One attribute. Raises `UnknownAttributeError` when the catalog has no such row."""

    @abstractmethod
    async def read_data_sources(self) -> tuple[DataSource, ...]:
        """Every source, so the global priority order can be resolved from it."""

    @abstractmethod
    async def read_breakdown_schemes(
        self,
    ) -> Mapping[BreakdownSchemeId, tuple[BreakdownOptionId, ...]]:
        """What each multi-value attribute is broken down by, with the options in it."""

    @abstractmethod
    async def read_match_rules(self, *, level: str | None = None) -> tuple[MatchRule, ...]:
        """The named gates (`reqs.md` 3.7). A rule with no level is returned at every level.

        **Whether a gate is enforced is not here and could not be.** That is a preference held
        by a criteria set, and reading it through this seam would put the subjective half of
        the ontology behind the objective one (`arch.md` 3.6). This returns what exists, never
        what counts.

        The answers themselves are not here either: a result belongs to a candidate rather
        than to the catalog, and `arch.md` 6.3 gives it its own seam in the module that holds
        the preference deciding whether to read it.
        """

    @abstractmethod
    async def read_compound_rules(self, *, level: str | None = None) -> tuple[CompoundRule, ...]:
        """The rules that read more than one figure (`reqs.md` 3.7a), children attached.

        A rule comes back carrying whichever children its shape uses, so a caller never has to
        know which of the two to ask for before it can ask.

        A rule whose thresholds are still TBD comes back with them absent rather than
        defaulted, and `CompoundRule.is_decided` is how a caller tells one apart. Supplying a
        default here would be inventing the judgement the application exists to help make.
        """
