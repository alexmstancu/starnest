"""Where values come from, and the order in which they are believed.

`reqs.md` 3.5 and 6.6. Manual entry is a source like any other, and so is the LLM: both are
rows in the same table, both rank in the same order, and neither gets special treatment
anywhere except where a document says so.

**Priority is a standing editorial judgement, not a quality grade.** It says which source to
believe *for this measurement* -- Numbeo beats national statistics for city rent, despite being
the less reliable source in general. Confidence (`confidence.py`) grades one particular number.
Neither subsumes the other, which is why the active-value rule consults both.
"""

from collections.abc import Iterable, Mapping, Sequence
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from starnest.data.identifiers import DataSourceId, ReliabilityTierId


class UnknownDataSourceError(LookupError):
    """A request named a source the catalog does not contain, in its body.

    **A fault in what was sent**, which is why the API answers 422: the request reached a real
    resource and asked it to record something impossible. `NoSuchDataSourceError` is the other
    half -- a path naming a source that is not there -- and the two are kept apart because the
    remedy differs. One means "correct the value you sent"; the other means "there is nothing
    at this address".
    """


class NoSuchDataSourceError(LookupError):
    """A path named a source the catalog does not contain.

    404, like every other named resource that is not there (P93). This used to share
    `UnknownDataSourceError` and so answered 422, alone among the endpoints that address a
    thing by id.
    """


class InvalidSourcePriorityError(ValueError):
    """A priority order does not describe a single ranking of distinct sources."""


class InvalidSourceOrderError(ValueError):
    """A reorder did not name every source exactly once (D36).

    `details` lists what was `missing`, `repeated` and `unknown`, every list present and empty
    where nothing was wrong with it, so a client words the refusal without parsing prose.
    """

    def __init__(self, *, missing: list[str], repeated: list[str], unknown: list[str]) -> None:
        super().__init__(
            "a source order names every source exactly once: "
            f"missing {missing}, repeated {repeated}, unknown {unknown}"
        )
        self.details = {"missing": missing, "repeated": repeated, "unknown": unknown}


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
    is_enabled: bool = Field(
        default=True,
        description=(
            "Whether this source is consulted. False means a run does not ask it and its "
            "stored values are not scored -- the values are kept and stay visible, because "
            "selecting an active value never discards data (`reqs.md` 3.6)."
        ),
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
        sources = list(sources)
        self._default_priority = _distinct_default_priorities(sources)
        self._override_rank = _distinct_override_ranks(overrides, known=self._default_priority)
        # **Which sources are switched off, so the Python rule can apply the view's rule 1a.**
        # `active_value` requires `source_is_enabled` and `select_active_value` did not, so the
        # two could name different winners for the same rows -- the one thing this module's
        # docstring says must never happen (P87).
        self._switched_off = frozenset(source.id for source in sources if not source.is_enabled)

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

    def is_switched_off(self, source: DataSourceId | str) -> bool:
        """Whether the household has switched this source off (`reqs.md` 2, Q232).

        A switched-off source keeps every value it ever stored and simply stops competing for
        the active one -- the same shape as a rejected value, and for the same reason: nothing
        is discarded, it just does not win.
        """
        return source in self._switched_off

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


def reorder_keeping_tiers(
    sources: Sequence[DataSource], order: Sequence[str]
) -> dict[DataSourceId, int]:
    """Every source's priority once the sources stand in `order` (D36, PL-136, PL-137).

    **The stored numbers are handed back out, never renumbered 1 to n**: sorted, they go to the
    sources in their new order, so the gaps between tiers -- which a person set, and which leave
    room for a source to be slotted in between -- survive every move.

    **A tie reads back by id** (`select_data_sources`, P76), so a tie the new order puts against
    the id order is broken by giving the later source one more than the earlier. That is the only
    number not taken from the stored set, and it is how two tied sources are swapped.
    """
    _refuse_unless_each_source_once(sources, order)
    slots = sorted(source.default_priority for source in sources)
    priorities: dict[DataSourceId, int] = {}
    previous: tuple[int, str] | None = None
    for slot, name in zip(slots, order, strict=True):
        priority = slot
        if previous is not None and priority <= previous[0]:
            priority = previous[0] if name > previous[1] else previous[0] + 1
        priorities[DataSourceId(name)] = priority
        previous = (priority, name)
    return priorities


def _refuse_unless_each_source_once(sources: Sequence[DataSource], order: Sequence[str]) -> None:
    known = [str(source.id) for source in sources]
    named = set(order)
    missing = [name for name in sorted(known) if name not in named]
    repeated = sorted({name for name in order if order.count(name) > 1})
    unknown = [name for name in dict.fromkeys(order) if name not in set(known)]
    if missing or repeated or unknown:
        raise InvalidSourceOrderError(missing=missing, repeated=repeated, unknown=unknown)
