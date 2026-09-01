"""The record everything else is measured against, and what it refuses.

Two themes run through these tests. The first is that a household with a wrong number in it
would not fail loudly -- it would produce a plausible affordability figure that is wrong --
so the sad paths here matter more than the happy one. The second is that no test may name
Romania, Bucharest or `country` as anything but a value: the home country is a parameter
(`reqs.md` 3.9), and a test that hardcoded it would stop noticing if the code did too.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.candidates import CandidateId, MalformedIdentifierError
from starnest.household import Household, HouseholdPlaceError

HOME_COUNTRY = CandidateId("country.romania")
HOME_CITY = CandidateId("city.romania.bucharest")
ANOTHER_COUNTRY = CandidateId("country.portugal")


def a_household(**overrides: object) -> Household:
    """A household that is valid in every respect, so a test can spoil exactly one thing."""
    fields: dict[str, object] = {
        "net_income": Decimal("5000"),
        "number_adults": 2,
        "number_children": 0,
        "home_country_candidate": HOME_COUNTRY,
        "citizenships": {HOME_COUNTRY},
    }
    return Household(**(fields | overrides))  # type: ignore[arg-type]


def the_domain_error(error: ValidationError) -> BaseException:
    """The error the domain raised, out from under the Pydantic wrapper."""
    return error.errors()[0]["ctx"]["error"]


class TestWhatTheHouseholdKnowsAboutItself:
    def test_size_counts_everyone_the_money_has_to_cover(self) -> None:
        assert a_household(number_adults=2, number_children=3).size == 5

    def test_a_household_without_children_says_so(self) -> None:
        assert a_household(number_children=0).has_children is False

    def test_a_household_with_children_says_so(self) -> None:
        assert a_household(number_children=1).has_children is True

    def test_recognises_where_you_live_now(self) -> None:
        household = a_household()
        assert household.is_home_country(HOME_COUNTRY) is True
        assert household.is_home_country(ANOTHER_COUNTRY) is False

    def test_reports_which_citizenships_it_holds(self) -> None:
        household = a_household(citizenships={HOME_COUNTRY})
        assert household.holds_citizenship_of(HOME_COUNTRY) is True
        assert household.holds_citizenship_of(ANOTHER_COUNTRY) is False

    def test_holds_more_than_one_citizenship(self) -> None:
        household = a_household(citizenships={HOME_COUNTRY, ANOTHER_COUNTRY})
        assert household.holds_citizenship_of(HOME_COUNTRY)
        assert household.holds_citizenship_of(ANOTHER_COUNTRY)

    def test_accepts_a_plain_string_for_every_place_it_names(self) -> None:
        """The API hands over JSON, so the identifiers arrive as strings and validate here."""
        household = Household(
            net_income=Decimal("5000"),
            number_adults=2,
            number_children=0,
            home_country_candidate="country.romania",
            home_city_candidate="city.romania.bucharest",
            citizenships={"country.romania"},
        )
        assert household.home_city_candidate == HOME_CITY

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            a_household().net_income = Decimal("1")

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            a_household(favourite_colour="green")


class TestTheNumbersItRefuses:
    def test_refuses_a_negative_income(self) -> None:
        with pytest.raises(ValidationError):
            a_household(net_income=Decimal("-1"))

    def test_accepts_no_income_at_all(self) -> None:
        """Zero is a real answer -- someone living on savings -- and negative is not."""
        assert a_household(net_income=Decimal("0")).net_income == 0

    @pytest.mark.parametrize("number_adults", [0, -1])
    def test_refuses_a_household_with_no_adult(self, number_adults: int) -> None:
        with pytest.raises(ValidationError):
            a_household(number_adults=number_adults)

    def test_refuses_a_negative_number_of_children(self) -> None:
        with pytest.raises(ValidationError):
            a_household(number_children=-1)

    @pytest.mark.parametrize("field", ["target_monthly_spend", "max_rent"])
    def test_refuses_a_negative_ceiling(self, field: str) -> None:
        with pytest.raises(ValidationError):
            a_household(**{field: Decimal("-1")})

    @pytest.mark.parametrize("field", ["target_monthly_spend", "max_rent"])
    def test_leaves_a_provisional_ceiling_unset_rather_than_guessing_one(self, field: str) -> None:
        """`reqs.md` 3.9 marks both provisional, so neither may arrive with a default."""
        assert getattr(a_household(), field) is None

    @pytest.mark.parametrize("field", ["net_income", "number_adults", "number_children"])
    def test_refuses_to_be_built_without_a_field_that_has_no_honest_default(
        self, field: str
    ) -> None:
        fields = {
            "net_income": Decimal("5000"),
            "number_adults": 2,
            "number_children": 0,
            "home_country_candidate": HOME_COUNTRY,
            "citizenships": {HOME_COUNTRY},
        }
        del fields[field]
        with pytest.raises(ValidationError):
            Household(**fields)  # type: ignore[arg-type]


class TestThePlacesItNames:
    def test_a_home_city_sits_inside_the_home_country(self) -> None:
        household = a_household(home_city_candidate=HOME_CITY)
        assert household.home_city_candidate == HOME_CITY

    def test_a_home_city_is_optional(self) -> None:
        assert a_household().home_city_candidate is None

    def test_refuses_a_malformed_home_country(self) -> None:
        with pytest.raises(ValidationError) as refused:
            a_household(home_country_candidate="Romania")
        assert isinstance(the_domain_error(refused.value), MalformedIdentifierError)

    def test_refuses_a_home_country_taken_from_the_wrong_level(self) -> None:
        """`city.romania.bucharest` is a real candidate; it is not a country."""
        with pytest.raises(ValidationError) as refused:
            a_household(home_country_candidate=HOME_CITY, citizenships={HOME_CITY})
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_home_city_in_a_different_country(self) -> None:
        with pytest.raises(ValidationError) as refused:
            a_household(home_city_candidate="city.portugal.lisbon")
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_home_city_that_is_really_a_country(self) -> None:
        with pytest.raises(ValidationError) as refused:
            a_household(home_city_candidate=ANOTHER_COUNTRY)
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_home_city_from_deeper_in_the_hierarchy(self) -> None:
        """A neighbourhood is inside the home country too, and is still not the home city."""
        with pytest.raises(ValidationError) as refused:
            a_household(home_city_candidate="neighbourhood.romania.bucharest.floreasca")
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_citizenship_at_the_level_of_cities(self) -> None:
        with pytest.raises(ValidationError) as refused:
            a_household(citizenships={HOME_COUNTRY, HOME_CITY})
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_citizenship_of_somewhere_inside_a_country(self) -> None:
        """Same level name, one segment too many -- a region, not a country."""
        with pytest.raises(ValidationError) as refused:
            a_household(citizenships={CandidateId("country.spain.catalonia")})
        assert isinstance(the_domain_error(refused.value), HouseholdPlaceError)

    def test_refuses_a_household_with_no_citizenship(self) -> None:
        """Free movement and visa gates turn on this; empty would let them pass silently."""
        with pytest.raises(ValidationError):
            a_household(citizenships=set())

    def test_refuses_to_be_built_without_citizenship_at_all(self) -> None:
        with pytest.raises(ValidationError):
            Household(
                net_income=Decimal("5000"),
                number_adults=2,
                number_children=0,
                home_country_candidate=HOME_COUNTRY,
            )

    def test_refuses_to_be_built_without_a_home_country(self) -> None:
        with pytest.raises(ValidationError):
            Household(
                net_income=Decimal("5000"),
                number_adults=2,
                number_children=0,
                citizenships={HOME_COUNTRY},
            )


class TestThatThereIsExactlyOneHousehold:
    def test_carries_no_identifier(self) -> None:
        """An `id` is the thing that would make a second household mean something.

        The database enforces the same fact from the other side with `CHECK (id = 1)`;
        neither side relies on the other remembering.
        """
        assert "id" not in Household.model_fields

    def test_cannot_be_given_one(self) -> None:
        with pytest.raises(ValidationError):
            a_household(id=2)

    def test_two_households_built_from_the_same_facts_are_the_same_household(self) -> None:
        """With no identity of its own, the record is its values -- so there is one of it."""
        assert a_household() == a_household()
        assert hash(a_household()) == hash(a_household())
