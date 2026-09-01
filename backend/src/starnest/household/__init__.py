"""The household record, the application settings, and what reads from them.

`arch.md` 6.1: this module **may import only `candidates/`**. It is on the subjective side of
the ontology (`arch.md` 3.6) -- it describes the asker, not any candidate -- and `data/` is
forbidden from importing it, which is the objective/subjective invariant written as an import
rule that a build can fail on.

Two records live here, and both are singletons in the strong sense: neither carries an
identifier, and `HouseholdStore` accepts none. A second household is not merely unlikely,
there is nothing that could name it.

**How this module refuses things.** Every fault is a `ValueError` or a `LookupError`.
Constructing a `Household` goes through Pydantic, so a bad field or an impossible set of
places is reported as a `ValidationError` (itself a `ValueError`); the domain error --
`HouseholdPlaceError` -- is recoverable from `error.errors()[0]["ctx"]["error"]`. Asking for a
household that was never configured raises `HouseholdNotConfiguredError`, which is a
`LookupError` because it is a miss, not a malformed value.
"""

from starnest.household.household import (
    Household,
    HouseholdNotConfiguredError,
    HouseholdPlaceError,
)
from starnest.household.settings import Settings
from starnest.household.store import HouseholdStore

__all__ = [
    "Household",
    "HouseholdNotConfiguredError",
    "HouseholdPlaceError",
    "HouseholdStore",
    "Settings",
]
