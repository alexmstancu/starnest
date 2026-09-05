"""`HouseholdStore` against PostgreSQL: the two single-row records.

`arch.md` 6.3. Neither table takes an identifier and neither method offers one: there is one
household because there is one user, running locally, with no accounts and no multi-tenancy.
The schema pins the primary key with `CHECK (id = 1)` and the domain agrees from the other
side by having nowhere to put one, so the rule holds even if one of the two forgets it.

**The household is replaced whole, in one transaction.** The record and its citizenships are
two tables, and a change that reached one but not the other would leave a household holding a
passport it had just given up -- which every visa gate would then read as fact
(`reqs.md` 7.3).
"""

from typing import Any

from psycopg.errors import ForeignKeyViolation
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import CandidateId
from starnest.household import (
    Household,
    HouseholdNotConfiguredError,
    HouseholdPlaceError,
    HouseholdStore,
    Settings,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresHouseholdStore(HouseholdStore):
    """The household seam, backed by the two singleton tables and the citizenship list."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def get_household(self) -> Household:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_household(connection)
        if row is None:
            raise HouseholdNotConfiguredError(
                "nothing has been recorded about the household yet; it is the first thing "
                "configured when the application is opened"
            )
        return _household_from(row)

    async def replace_household(self, household: Household) -> None:
        """One transaction for both tables. A half-written household is not a household.

        A candidate the household names but the catalog does not hold arrives here as a driver
        error, and is translated: `psycopg` types belong to this module and must not reach
        `api/`, where an untranslated one becomes a 500 for a request that was merely wrong.
        The domain already has the word for it -- a place the household names is not one it
        could possibly be at.
        """
        try:
            await self._write(household)
        except ForeignKeyViolation as unknown:
            raise HouseholdPlaceError(
                f"the household names a place the catalog does not hold: {unknown}"
            ) from unknown

    async def _write(self, household: Household) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.upsert_household(
                connection,
                net_income=household.net_income,
                number_adults=household.number_adults,
                number_children=household.number_children,
                target_monthly_spend=household.target_monthly_spend,
                max_rent=household.max_rent,
                home_country_candidate=str(household.home_country_candidate),
                home_city_candidate=(
                    None
                    if household.home_city_candidate is None
                    else str(household.home_city_candidate)
                ),
            )
            await self._queries.replace_household_citizenships(
                connection,
                candidates=sorted(str(citizenship) for citizenship in household.citizenships),
            )

    async def get_settings(self) -> Settings:
        """The four tuning values, every one of which may legitimately not be set yet.

        No row means nothing has been configured, which is exactly what a `Settings` with four
        `None` fields says -- so there is nothing to raise here, unlike the household, whose
        required fields have no honest empty value.
        """
        async with acquire(self._pool) as connection:
            row = await self._queries.select_settings(connection)
        if row is None:
            return Settings()
        return Settings(
            min_coverage=row.min_coverage,
            score_scale_max=row.score_scale_max,
            comparator_limit=row.comparator_limit,
            run_spend_cap_eur=row.run_spend_cap_eur,
        )

    async def replace_settings(self, settings: Settings) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.upsert_settings(
                connection,
                min_coverage=settings.min_coverage,
                score_scale_max=settings.score_scale_max,
                comparator_limit=settings.comparator_limit,
                run_spend_cap_eur=settings.run_spend_cap_eur,
            )


def _household_from(row: Any) -> Household:
    """The row as the domain record, without the display names it travels with.

    `select_household` joins the candidate names on so one screen is one round trip, but a
    name is presentation: it is not part of what a household *is*, it changes without the
    household changing, and putting it on the record would give the same string two homes.
    """
    return Household(
        net_income=row.net_income,
        number_adults=row.number_adults,
        number_children=row.number_children,
        target_monthly_spend=row.target_monthly_spend,
        max_rent=row.max_rent,
        home_country_candidate=CandidateId(row.home_country_candidate),
        home_city_candidate=(
            CandidateId(row.home_city_candidate) if row.home_city_candidate else None
        ),
        citizenships=frozenset(
            CandidateId(citizenship["candidate"]) for citizenship in row.citizenships
        ),
    )
