"""`HouseholdStore` against the two singleton tables.

Neither table is seeded and neither ever will be: every number in both is provisional
(`reqs.md` 3.9, 3.10), so the state these tests start in -- nothing recorded at all -- is the
state a freshly installed application is in, and the two seams answer it in deliberately
different ways.
"""

from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.household import Household, HouseholdNotConfiguredError, Settings
from starnest.storage import PostgresHouseholdStore

pytestmark = pytest.mark.storage

HOME_COUNTRY = "country.romania"
ANOTHER_COUNTRY = "country.portugal"


HOME_CITY = "city.romania.bucharest"


@pytest.fixture
def households(pool: AsyncConnectionPool) -> PostgresHouseholdStore:
    return PostgresHouseholdStore(pool)


@pytest.fixture
async def home_city(pool: AsyncConnectionPool) -> AsyncIterator[str]:
    """A city to be the household's reference point for travel connections.

    None are seeded: the MVP is the country level (`reqs.md` 1.3). The column exists and the
    seam has to answer for it, so the row is added for one test and removed again.
    """
    async with pool.connection() as connection:
        await connection.execute(
            "INSERT INTO candidate (id, name, level, parent_level, parent_candidate,"
            "                       parent_required)"
            " SELECT %s, 'Bucharest', l.id, 'country', %s, l.requires_parent"
            " FROM level AS l WHERE l.id = 'city'",
            (HOME_CITY, HOME_COUNTRY),
        )
    yield HOME_CITY
    async with pool.connection() as connection:
        await connection.execute("UPDATE household SET home_city_candidate = NULL")
        await connection.execute("DELETE FROM candidate WHERE id = %s", (HOME_CITY,))


def a_household(
    *,
    citizenships: frozenset[str] = frozenset({HOME_COUNTRY}),
    target_monthly_spend: Decimal | None = Decimal("2500"),
    max_rent: Decimal | None = Decimal("900"),
) -> Household:
    return Household(
        net_income=Decimal("4200.50"),
        number_adults=2,
        number_children=1,
        target_monthly_spend=target_monthly_spend,
        max_rent=max_rent,
        home_country_candidate=HOME_COUNTRY,
        citizenships=citizenships,
    )


async def test_asking_for_a_household_nobody_has_recorded_is_a_miss_not_an_empty_record(
    households: PostgresHouseholdStore,
) -> None:
    """Income, size and home country have no honest empty value, so none is invented."""
    with pytest.raises(HouseholdNotConfiguredError):
        await households.get_household()


async def test_a_household_survives_the_round_trip_with_its_citizenships(
    households: PostgresHouseholdStore,
) -> None:
    household = a_household(citizenships=frozenset({HOME_COUNTRY, ANOTHER_COUNTRY}))

    await households.replace_household(household)

    assert await households.get_household() == household


async def test_the_optional_ceilings_stay_unset_rather_than_becoming_zero(
    households: PostgresHouseholdStore,
) -> None:
    """A zero ceiling is a household that may spend nothing; an unset one is no ceiling."""
    household = a_household(target_monthly_spend=None, max_rent=None)

    await households.replace_household(household)

    stored = await households.get_household()
    assert stored.target_monthly_spend is None
    assert stored.max_rent is None


async def test_replacing_a_household_replaces_its_citizenships_rather_than_adding_to_them(
    households: PostgresHouseholdStore,
) -> None:
    """A correction that dropped a passport must actually drop it (`reqs.md` 7.3)."""
    await households.replace_household(
        a_household(citizenships=frozenset({HOME_COUNTRY, ANOTHER_COUNTRY}))
    )

    await households.replace_household(a_household(citizenships=frozenset({HOME_COUNTRY})))

    assert (await households.get_household()).citizenships == frozenset({HOME_COUNTRY})


async def test_saving_an_unchanged_household_twice_is_not_a_duplicate(
    households: PostgresHouseholdStore,
) -> None:
    """The citizenship replacement keeps what it keeps, rather than deleting and re-inserting."""
    household = a_household(citizenships=frozenset({HOME_COUNTRY, ANOTHER_COUNTRY}))

    await households.replace_household(household)
    await households.replace_household(household)

    assert await households.get_household() == household


async def test_settings_nobody_has_configured_read_as_four_unset_values(
    households: PostgresHouseholdStore,
) -> None:
    """Never an error: all-`None` is precisely what "not configured yet" means here."""
    assert await households.get_settings() == Settings()


async def test_settings_survive_the_round_trip_typed(
    households: PostgresHouseholdStore,
) -> None:
    """Typed columns rather than a key/value bag, so each comes back as the type it is."""
    settings = Settings(
        min_coverage=Decimal("60"),
        score_scale_max=100,
        comparator_limit=5,
        run_spend_cap_eur=Decimal("12.50"),
    )

    await households.replace_settings(settings)

    assert await households.get_settings() == settings


async def test_replacing_settings_can_clear_one_back_to_unset(
    households: PostgresHouseholdStore,
) -> None:
    """Replace, not patch: clearing the spend cap is passing nothing, not passing zero."""
    await households.replace_settings(Settings(comparator_limit=5, run_spend_cap_eur=Decimal(20)))

    await households.replace_settings(Settings(comparator_limit=5))

    stored = await households.get_settings()
    assert stored.comparator_limit == 5
    assert stored.run_spend_cap_eur is None


async def test_a_home_city_is_recorded_and_read_back_when_there_is_one(
    households: PostgresHouseholdStore, home_city: str
) -> None:
    """The reference city for travel connections. Optional, and absent by default."""
    household = a_household().model_copy(update={"home_city_candidate": home_city})

    await households.replace_household(household)

    assert (await households.get_household()).home_city_candidate == home_city
