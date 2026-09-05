"""The household: who is moving, and the figures every affordability question turns on.

`reqs.md` 3.9. One record, because there is one user running locally -- no accounts, no
permissions, no multi-tenancy (`reqs.md` 10). Neither endpoint takes an identifier, and the
schema agrees from the other side with `CHECK (id = 1)`.

**Replaced whole, never patched.** A change to the household must reach criterion defaults,
cross-attribute warnings and match rules at once (`reqs.md` 3.9), and a whole-record write is
what makes that one event rather than several. A PATCH that moved `net_income` without
`target_monthly_spend` would leave an affordability rule reading two figures from two different
decisions.

**Absent is not empty.** Reading a household nobody has configured raises rather than returning
zeros: income, size and home country have no honest empty value, and inventing one would make
every affordability figure quietly wrong.
"""

from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from starnest.api.dependencies import Households
from starnest.household import Household

router = APIRouter(tags=["household"])


class HouseholdBody(BaseModel):
    """`HouseholdInput` from the contract, which `Household` is defined as."""

    net_income: float
    number_adults: int = Field(ge=1)
    number_children: int = Field(ge=0, description="Under 18.")
    home_country_candidate: str
    citizenships: tuple[str, ...] = Field(min_length=1)
    target_monthly_spend: float | None = None
    max_rent: float | None = None
    home_city_candidate: str | None = None


@router.get("/household", operation_id="getHousehold", response_model=HouseholdBody)
async def get_household(households: Households) -> HouseholdBody:
    """Raises `HouseholdNotConfiguredError` -- a 404 -- when nothing has been recorded yet."""
    return _body(await households.get_household())


@router.put("/household", operation_id="replaceHousehold", response_model=HouseholdBody)
async def replace_household(household: HouseholdBody, households: Households) -> HouseholdBody:
    """Store the household whole, and return what was stored.

    Returning it rather than a bare 200: the domain normalises what it accepts -- citizenships
    are a set, so duplicates collapse -- and a client that assumed its request body was the
    stored state would be wrong in a way nothing told it about.
    """
    await households.replace_household(
        Household(
            net_income=Decimal(str(household.net_income)),
            number_adults=household.number_adults,
            number_children=household.number_children,
            home_country_candidate=household.home_country_candidate,
            citizenships=frozenset(household.citizenships),
            target_monthly_spend=_decimal_or_none(household.target_monthly_spend),
            max_rent=_decimal_or_none(household.max_rent),
            home_city_candidate=household.home_city_candidate,
        )
    )
    return _body(await households.get_household())


def _body(household: Household) -> HouseholdBody:
    return HouseholdBody(
        net_income=float(household.net_income),
        number_adults=household.number_adults,
        number_children=household.number_children,
        home_country_candidate=str(household.home_country_candidate),
        # Sorted, because the domain holds a set and a JSON array is ordered. An arbitrary order
        # would make two identical households serialise differently between reads.
        citizenships=tuple(sorted(str(one) for one in household.citizenships)),
        target_monthly_spend=_float_or_none(household.target_monthly_spend),
        max_rent=_float_or_none(household.max_rent),
        home_city_candidate=(
            str(household.home_city_candidate) if household.home_city_candidate else None
        ),
    )


def _decimal_or_none(figure: float | None) -> Decimal | None:
    """Money never becomes a float in the domain (`arch.md` 9.6), and JSON has only floats.

    Through `str` rather than directly: `Decimal(2900.1)` is 2900.099999999999909050529822;
    `Decimal("2900.1")` is 2900.1.
    """
    return None if figure is None else Decimal(str(figure))


def _float_or_none(figure: Decimal | None) -> float | None:
    return None if figure is None else float(figure)
