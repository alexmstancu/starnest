"""What one particular number is worth, as opposed to how much of the picture is filled in.

`reqs.md` 5.7. Coverage says *how much* of the active weight is backed by data; confidence
says *what that data is worth*. A candidate can reach 100% coverage entirely on extrapolation,
and coverage alone would not show it.

**Confidence is derived, not typed.** It is computed from the source's reliability tier, then
downgraded once for each way the figure is degraded: older than the attribute's `max_age`,
measured over a geography coarser than the candidate, or derived from a related figure rather
than reported directly.

**What it must never affect is the arithmetic.** A low-confidence value is not discounted or
shrunk toward the mean; it is disclosed. That is why nothing in this module returns a
multiplier -- the only thing confidence is allowed to decide is which of two competing values
is read (`arch.md` 4, rule 4) and what the screen says beside a number.
"""

from collections.abc import Mapping
from enum import StrEnum

from starnest.data.identifiers import ReliabilityTierId
from starnest.data.sources import DataSource


class UnknownReliabilityTierError(LookupError):
    """A source's tier has no confidence grade in the mapping supplied."""


class ConfidenceLevel(StrEnum):
    """The four grades, strongest first.

    Declaration order *is* the ladder: `priority_order` and `downgraded` both read it, so the
    ranking the `confidence_level` reference table stores and the ranking this module applies
    cannot disagree.
    """

    ABSOLUTE = "absolute"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

    @property
    def priority_order(self) -> int:
        """Where this grade sorts when confidence breaks a tie. 1 is the strongest.

        The same numbers the seeded `confidence_level` table carries, so the pure
        active-value rule and the database view order identically.
        """
        return _LADDER.index(self) + 1

    def downgraded(self, steps: int = 1) -> "ConfidenceLevel":
        """This grade, weakened by `steps` rungs. `low` is the floor; nothing falls off it."""
        if steps < 0:
            raise ValueError("confidence is downgraded, never upgraded")
        return _LADDER[min(_LADDER.index(self) + steps, len(_LADDER) - 1)]


_LADDER: tuple[ConfidenceLevel, ...] = tuple(ConfidenceLevel)

MANUAL_ENTRY_DEFAULT_CONFIDENCE = ConfidenceLevel.MEDIUM
"""What a typed value is worth until a person says otherwise (`reqs.md` 5.7).

A deliberately unflattering middle. A researched visa result read off an official page
deserves `high` and a rough rent estimate deserves `low`, and both arrive as manual entry --
so the tier says nothing useful and the grade is set per value instead.
"""


def derive_confidence(
    source: DataSource,
    *,
    grade_of_tier: Mapping[ReliabilityTierId | str, ConfidenceLevel],
    is_stale: bool = False,
    covers_a_coarser_geography: bool = False,
    is_derived: bool = False,
) -> ConfidenceLevel:
    """The grade a value earns from its source and the three ways it may be degraded.

    Each degradation costs one rung, and `low` is the floor. Manual entry short-circuits the
    whole computation and returns `MANUAL_ENTRY_DEFAULT_CONFIDENCE`, because a tier cannot
    say what a typed figure is worth (`reqs.md` 5.7).

    **`grade_of_tier` is a parameter and not a table in this module, deliberately.** Which
    grade each reliability tier starts from is objective policy, and objective policy is
    catalog data (`arch.md` 1.2) -- writing `official_international` as a literal here would
    hardcode exactly the kind of row the rest of the design keeps in the database. The
    documents do not yet say where that mapping lives, so the caller states it and this
    function refuses a tier the caller did not account for rather than guessing one.
    """
    if source.is_typed_by_hand:
        return MANUAL_ENTRY_DEFAULT_CONFIDENCE
    try:
        grade = grade_of_tier[source.reliability_tier]
    except KeyError:
        raise UnknownReliabilityTierError(
            f"source {source.id!r} is of tier {source.reliability_tier!r}, which has no "
            f"confidence grade; the mapping covers {sorted(grade_of_tier)}"
        ) from None
    degradations = sum((is_stale, covers_a_coarser_geography, is_derived))
    return grade.downgraded(degradations)
