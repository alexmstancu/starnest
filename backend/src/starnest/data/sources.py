"""Where values come from, and the order in which they are believed.

`reqs.md` 3.5 and 6.6. Manual entry is a source like any other, and so is the LLM: both are
rows in the same table, both rank in the same order, and neither gets special treatment
anywhere except where a document says so.

**Priority is a standing editorial judgement, not a quality grade.** It says which source to
believe *for this measurement* -- Numbeo beats national statistics for city rent, despite being
the less reliable source in general. Confidence (`confidence.py`) grades one particular number.
Neither subsumes the other, which is why the active-value rule consults both.
"""

from collections.abc import Iterable, Mapping
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from starnest.data.identifiers import DataSourceId, ReliabilityTierId


class UnknownDataSourceError(LookupError):
    """A source was asked for that the catalog does not contain."""


class InvalidSourcePriorityError(ValueError):
    """A priority order does not describe a single ranking of distinct sources."""


class SourceKind(StrEnum):
    """How a source is read, which is not the same as how much it is worth.

    The three the schema admits. `manual` covers everything a person types in, including a
    figure read off an official page -- which is exactly why confidence for a manual source
    is set per value rather than derived (`reqs.md` 5.7).
    """

    STRUCTURED = "structured"
    LLM = "llm"
    MANUAL = "manual"


class DataSource(BaseModel):
    """One place values come from: `eurostat`, `numbeo`, `llm`, `manual`.

    A source also publishes `ExternalScore` rows, which is why providers such as Numbeo are
    rows here rather than names in a text column (`reqs.md` 3.5a).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: DataSourceId
    name: str
    source_kind: SourceKind
    default_priority: int = Field(
        description=(
            "Rank in the global source order of `reqs.md` 6.6. **Lower is higher priority**, "
            "as in the seeded catalog and the active-value view."
        )
    )
    reliability_tier: ReliabilityTierId = Field(
        description="The family confidence is derived from (`reqs.md` 5.7)."
    )

    @property
    def is_typed_by_hand(self) -> bool:
        """Whether values from this source are entered by a person rather than fetched."""
        return self.source_kind is SourceKind.MANUAL


class SourcePriorityOverride(BaseModel):
    """One line of an attribute's replacement for the global order (`reqs.md` 6.6)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    data_source: DataSourceId
    rank: int = Field(gt=0, description="Lower is higher priority. Unique within an attribute.")


class SourcePriority:
    """The order sources are consulted for one attribute -- the whole order, resolved.

    **An override is partial** (`reqs.md` 6.6): the sources it names take the order it gives
    them, and every other source keeps its global order beneath them. So an override of
    `[numbeo, national_statistics]` yields `numbeo > national_statistics > eurostat > llm >
    manual`, and connecting a new adapter never requires revisiting an existing override --
    the new source enters at its global rank, below anything explicitly promoted.
    """

    def __init__(
        self,
        *,
        sources: Iterable[DataSource],
        overrides: Iterable[SourcePriorityOverride] = (),
    ) -> None:
        self._default_priority = _distinct_default_priorities(sources)
        self._override_rank = _distinct_override_ranks(overrides, known=self._default_priority)

    @classmethod
    def global_order(cls, sources: Iterable[DataSource]) -> Self:
        """The order every attribute inherits when it overrides nothing."""
        return cls(sources=sources)

    def rank_of(self, source: DataSourceId | str) -> tuple[int, int]:
        """Where this source sits, as a key that sorts ascending. Lower is believed first.

        Two numbers rather than one, mirroring the two ordering columns of the `active_value`
        view: overridden sources sort ahead of every un-overridden one, and within each group
        the declared rank decides. Collapsing them into a single integer would require
        renumbering the global order every time an override was edited.
        """
        if source in self._override_rank:
            return (0, self._override_rank[source])
        try:
            return (1, self._default_priority[source])
        except KeyError:
            raise UnknownDataSourceError(
                f"no source {source!r}; this priority knows {sorted(self._default_priority)}"
            ) from None

    @property
    def ordered(self) -> tuple[DataSourceId, ...]:
        """Every source, highest priority first. This is the effective order the app shows."""
        return tuple(sorted(self._default_priority, key=self.rank_of))

    def __repr__(self) -> str:
        return f"SourcePriority({list(self.ordered)})"


def _distinct_default_priorities(
    sources: Iterable[DataSource],
) -> Mapping[DataSourceId, int]:
    priorities: dict[DataSourceId, int] = {}
    for source in sources:
        if source.id in priorities:
            raise InvalidSourcePriorityError(f"source {source.id!r} was given twice")
        priorities[source.id] = source.default_priority
    if not priorities:
        raise InvalidSourcePriorityError("a source priority needs at least one source")
    return priorities


def _distinct_override_ranks(
    overrides: Iterable[SourcePriorityOverride],
    *,
    known: Mapping[DataSourceId, int],
) -> Mapping[DataSourceId, int]:
    ranks: dict[DataSourceId, int] = {}
    for override in overrides:
        if override.data_source not in known:
            raise UnknownDataSourceError(
                f"the override promotes {override.data_source!r}, which is not a known source"
            )
        if override.data_source in ranks:
            raise InvalidSourcePriorityError(
                f"source {override.data_source!r} is promoted twice by the same attribute"
            )
        if override.rank in ranks.values():
            raise InvalidSourcePriorityError(
                f"two sources are promoted to rank {override.rank} by the same attribute"
            )
        ranks[override.data_source] = override.rank
    return ranks
