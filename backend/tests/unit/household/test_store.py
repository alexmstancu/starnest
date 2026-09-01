"""The seam, and the two promises its shape makes.

`HouseholdStore` is abstract, so there is no behaviour to test -- but its *signature* carries
the singleton invariant (`arch.md` 6.3), and a signature is exactly the kind of thing that
drifts silently. These tests fail if someone adds the `household_id` parameter that would make
a second household mean something.
"""

import inspect
from decimal import Decimal

import pytest

from starnest.household import (
    Household,
    HouseholdNotConfiguredError,
    HouseholdStore,
    Settings,
)

A_HOUSEHOLD = Household(
    net_income=Decimal("5000"),
    number_adults=2,
    number_children=0,
    home_country_candidate="country.romania",
    citizenships={"country.romania"},
)

OPERATIONS = ("get_household", "replace_household", "get_settings", "replace_settings")


class InMemoryHouseholdStore(HouseholdStore):
    """The smallest implementation that satisfies the seam, used to prove it is satisfiable."""

    def __init__(self) -> None:
        self._household: Household | None = None
        self._settings = Settings()

    async def get_household(self) -> Household:
        if self._household is None:
            raise HouseholdNotConfiguredError("no household has been recorded yet")
        return self._household

    async def replace_household(self, household: Household) -> None:
        self._household = household

    async def get_settings(self) -> Settings:
        return self._settings

    async def replace_settings(self, settings: Settings) -> None:
        self._settings = settings


class TestTheSeam:
    def test_cannot_be_used_without_being_implemented(self) -> None:
        with pytest.raises(TypeError):
            HouseholdStore()  # type: ignore[abstract]

    @pytest.mark.parametrize("operation", OPERATIONS)
    def test_declares_the_operation_abstract(self, operation: str) -> None:
        assert operation in HouseholdStore.__abstractmethods__

    def test_declares_nothing_beyond_what_the_module_calls(self) -> None:
        """Interface Segregation: the module asks for what it uses and not one method more."""
        assert HouseholdStore.__abstractmethods__ == frozenset(OPERATIONS)

    @pytest.mark.parametrize("operation", OPERATIONS)
    def test_no_operation_takes_an_identifier(self, operation: str) -> None:
        """There is one household, so there is nothing to identify (`arch.md` 3.6)."""
        parameters = inspect.signature(getattr(HouseholdStore, operation)).parameters
        assert "self" in parameters
        assert not [name for name in parameters if "id" in name]

    @pytest.mark.parametrize("operation", OPERATIONS)
    def test_every_operation_is_awaitable(self, operation: str) -> None:
        """Storage is async throughout, and a seam that is not would force it to block."""
        assert inspect.iscoroutinefunction(getattr(HouseholdStore, operation))


class TestAnImplementationOfTheSeam:
    async def test_reads_back_the_household_it_was_given(self) -> None:
        store = InMemoryHouseholdStore()
        await store.replace_household(A_HOUSEHOLD)
        assert await store.get_household() == A_HOUSEHOLD

    async def test_refuses_to_invent_a_household_that_was_never_configured(self) -> None:
        """Income, size and home country have no honest empty value, so this raises."""
        with pytest.raises(HouseholdNotConfiguredError):
            await InMemoryHouseholdStore().get_household()

    async def test_reads_back_the_settings_it_was_given(self) -> None:
        store = InMemoryHouseholdStore()
        settings = Settings(comparator_limit=5)
        await store.replace_settings(settings)
        assert await store.get_settings() == settings

    async def test_unconfigured_settings_are_simply_unset(self) -> None:
        """No not-configured error for settings -- an all-unset record says the same thing."""
        assert await InMemoryHouseholdStore().get_settings() == Settings()
