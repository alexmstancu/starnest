"""The seam this module declares: somewhere to keep the two single-row records.

`arch.md` 6.3. The interface is declared by the module that *needs* it and implemented in
`storage/`, so the arrow of dependency runs opposite to the arrow of control and no policy
module ever names a concrete implementation.

**One store per module, not one per table** (`arch.md` 6.3). `household` owns two records and
declares one interface for both. Splitting it would give `storage` two objects to construct
and wire for a module that will only ever want them together.

**No method takes an identifier, and that is deliberate.** There is one household and one set
of settings; a `household_id` parameter is the thing that would make a second one meaningful.
The domain says so by having nowhere to put an identifier, and the schema says so with
`CHECK (id = 1)` -- neither relies on the other remembering.
"""

from abc import ABC, abstractmethod

from starnest.household.household import Household
from starnest.household.settings import Settings


class HouseholdStore(ABC):
    """Read and write the household record and the application settings.

    Four operations and no more: this is the whole of what `household` asks persistence for.
    Queries return; commands return nothing (`replace_household` is followed by
    `get_household` only where the caller genuinely needs to read it back).
    """

    @abstractmethod
    async def get_household(self) -> Household:
        """The household record.

        Raises `HouseholdNotConfiguredError` when nothing has been recorded yet. It is not
        an empty `Household`, because income, size and home country have no honest empty
        value and inventing one would make every affordability figure quietly wrong.
        """

    @abstractmethod
    async def replace_household(self, household: Household) -> None:
        """Store the household, replacing whatever was there.

        Replace rather than patch: a change to the household must reach criterion defaults,
        cross-attribute warnings and match rules at once (`reqs.md` 3.9), and a whole-record
        write is what makes that one event rather than several.
        """

    @abstractmethod
    async def get_settings(self) -> Settings:
        """The application settings, with every value nobody has set left unset.

        Never raises for an unconfigured application: a `Settings` whose fields are all
        `None` says exactly that, and says it in a form every caller already has to handle.
        """

    @abstractmethod
    async def replace_settings(self, settings: Settings) -> None:
        """Store the settings, replacing whatever was there."""
