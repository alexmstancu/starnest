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

import re
import unicodedata
from collections.abc import Iterator
from itertools import count

from starnest.data import CatalogId


class CriteriaSetId(CatalogId):
    """A named set of criteria: `local_employment`, `alex`, `remote_only` (`reqs.md` 3.4).

    Work-format scenarios and per-person sets are the same primitive, so they share one type:
    both are one opinion about the same measured attributes.
    """

    __slots__ = ()


def identifiers_from(name: str) -> Iterator[CriteriaSetId]:
    """Every identifier a set called `name` may take, in the order to try them (PL-039).

    Derived once, at creation, and never regenerated from the name afterwards (`arch.md` 3.2a):
    accents stripped, lower case, every run of anything else one underscore. A name with nothing
    left, or one starting with a digit, is prefixed `set`, because an identifier starts with a
    letter. Endless -- `zurich`, `zurich_2`, `zurich_3`... -- so the caller bounds it, taking the
    first one no set has ever held.
    """
    stem = _stem_of(name)
    yield CriteriaSetId(stem)
    for counter in count(2):
        yield CriteriaSetId(f"{stem}_{counter}")


def _stem_of(name: str) -> str:
    unaccented = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    stem = re.sub(r"[^a-z0-9]+", "_", unaccented.lower()).strip("_")
    if not stem:
        return "set"
    return f"set_{stem}" if stem[0].isdigit() else stem
