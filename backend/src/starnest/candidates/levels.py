"""The rungs of the place hierarchy, and the order between them.

`reqs.md` 3.1. The application ships with two levels -- `country` (depth 1) and `city`
(depth 2) -- and the MVP uses only the first. **The requirement is not that a third level be
built; it is that nothing here may assume there are exactly two.** A level is a record with
an ordinal and the level it nests under, and everything that needs ordering asks the
hierarchy rather than an enum.
"""

from collections.abc import Iterable, Iterator

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates.identifiers import LevelId


class InconsistentHierarchyError(ValueError):
    """A set of levels does not describe a single, ordered containment chain."""


class UnknownLevelError(LookupError):
    """A level was asked for that the hierarchy does not contain."""


class Level(BaseModel):
    """One rung: `country`, `city`.

    `depth_order` orders the rungs from the outside in, so 1 is the widest. `parent_level`
    says which rung contains this one, and is absent for the widest.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: LevelId
    depth_order: int = Field(ge=1, description="1 is the widest level. Unique across levels.")
    parent_level: LevelId | None = Field(
        default=None, description="The level that contains this one. Absent at the top."
    )

    @model_validator(mode="after")
    def _reject_nesting_under_itself(self) -> "Level":
        if self.parent_level == self.id:
            raise InconsistentHierarchyError(f"level {self.id!r} cannot nest under itself")
        return self

    @property
    def is_top_level(self) -> bool:
        """Whether this rung is contained by nothing -- true of `country`."""
        return self.parent_level is None

    def may_parent(self, child: "Level") -> bool:
        """Whether a candidate at this level may contain a candidate at `child`.

        This is the nesting rule at the level layer: `country.may_parent(city)` is true and
        `city.may_parent(city)` is false, whatever the two levels happen to be called.
        """
        return child.parent_level == self.id


class LevelHierarchy:
    """The complete set of levels, ordered, with the nesting each one declares.

    Constructing one validates the whole set at once, which is where the mistakes actually
    live: a duplicated ordinal, a parent that does not exist, two rungs claiming to be the
    widest. Candidates are seeded by migration, where such a mistake is easy and silent
    (`reqs.md` 3.1).
    """

    def __init__(self, levels: Iterable[Level]) -> None:
        ordered = tuple(sorted(levels, key=lambda level: level.depth_order))
        _reject_an_ill_formed_set(ordered)
        self._ordered = ordered
        self._by_id = {level.id: level for level in ordered}

    @property
    def ordered(self) -> tuple[Level, ...]:
        """Every level from the widest inwards."""
        return self._ordered

    @property
    def top_level(self) -> Level:
        """The widest level -- the one candidates at the root of the tree sit at."""
        return self._ordered[0]

    def get(self, level_id: str) -> Level:
        """The level with this identifier. Raises `UnknownLevelError` when there is none."""
        try:
            return self._by_id[level_id]
        except KeyError:
            raise UnknownLevelError(
                f"no level {level_id!r}; this hierarchy has {list(self._by_id)}"
            ) from None

    def children_of(self, level: Level) -> tuple[Level, ...]:
        """The levels that nest directly inside this one. Empty at the innermost level."""
        return tuple(candidate for candidate in self._ordered if level.may_parent(candidate))

    def __iter__(self) -> Iterator[Level]:
        return iter(self._ordered)

    def __len__(self) -> int:
        return len(self._ordered)

    def __contains__(self, level_id: object) -> bool:
        return level_id in self._by_id

    def __repr__(self) -> str:
        return f"LevelHierarchy({[level.id for level in self._ordered]})"


def _reject_an_ill_formed_set(ordered: tuple[Level, ...]) -> None:
    if not ordered:
        raise InconsistentHierarchyError("a hierarchy needs at least one level")

    _reject_duplicates("identifier", [level.id for level in ordered])
    _reject_duplicates("depth_order", [level.depth_order for level in ordered])

    tops = [level for level in ordered if level.is_top_level]
    if len(tops) != 1:
        raise InconsistentHierarchyError(
            "a hierarchy has exactly one widest level, but "
            f"{[level.id for level in tops]} declare no parent"
        )

    by_id = {level.id: level for level in ordered}
    for level in ordered:
        if level.parent_level is None:
            continue
        parent = by_id.get(level.parent_level)
        if parent is None:
            raise InconsistentHierarchyError(
                f"level {level.id!r} nests under {level.parent_level!r}, "
                "which is not in this hierarchy"
            )
        if parent.depth_order >= level.depth_order:
            raise InconsistentHierarchyError(
                f"level {level.id!r} nests under {parent.id!r}, which is not "
                "wider than it -- containment and depth_order must agree"
            )


def _reject_duplicates(what: str, values: Iterable[object]) -> None:
    seen = set()
    for value in values:
        if value in seen:
            raise InconsistentHierarchyError(f"two levels share the {what} {value!r}")
        seen.add(value)
