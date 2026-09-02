"""What this module calls a criteria set.

One vocabulary, following the single-segment convention of `arch.md` 3.2:
`local_employment`, `alex`, `remote_only`. A separate type rather than a bare string, so a
function asking for a `CriteriaSetId` cannot silently be handed a pillar's identifier -- both
are single segments and would otherwise be interchangeable.

**`MatchRuleId` and `CompoundRuleId` are deliberately not here.** A rule is a fact about the
world and lives in `data/` with the rest of the objective catalog (`reqs.md` 3.7). What this
module holds is only the preference: which of those rules a given set enforces.

**The alphabet is defined once, in `candidates/`, and restated nowhere.** This reuses
`CatalogId`, which is itself checked by constructing a `LevelId`.
"""

from starnest.data import CatalogId


class CriteriaSetId(CatalogId):
    """A named set of criteria: `local_employment`, `alex`, `remote_only` (`reqs.md` 3.4).

    Work-format scenarios and per-person sets are the same primitive, so they share one type:
    both are one opinion about the same measured attributes.
    """

    __slots__ = ()
