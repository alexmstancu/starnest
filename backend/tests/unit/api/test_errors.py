"""Turning a refusal pydantic wrapped back into the domain's own (BE-21).

A domain error raised inside a validator reaches the caller wrapped in a `ValidationError`, which
the error table has no row for -- so building a domain object from a request answered 500 where
the domain had written a sentence. `built_from_the_request` unwraps a refusal the table maps, and
leaves everything else exactly as it was: a native constraint the request body failed to mirror,
or a bug, must stay a loud 500 rather than become a tidy 422 nobody investigates.
"""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import BaseModel, ValidationError, model_validator

from starnest.api.errors import built_from_the_request, refusal_for
from starnest.candidates import MalformedIdentifierError
from starnest.criteria import ScaleAnchor, ThresholdShapeError
from starnest.data import InvalidReferencePeriodError, ReferencePeriod
from starnest.household import Household, HouseholdPlaceError

NEW_YEARS_DAY, NEW_YEARS_EVE = date(2026, 1, 1), date(2026, 12, 31)


class Unmapped(BaseModel):
    """A model refusing with a `ValueError` nothing in the error table names."""

    figure: int

    @model_validator(mode="after")
    def _refuse(self) -> "Unmapped":
        raise ValueError("a refusal nobody gave a status to")


def a_household(**overrides: object) -> Household:
    fields: dict[str, object] = {
        "net_income": Decimal(5000),
        "number_adults": 2,
        "number_children": 0,
        "home_country_candidate": "country.romania",
        "citizenships": frozenset({"country.romania"}),
    }
    return Household(**(fields | overrides))  # type: ignore[arg-type]


class TestARefusalBuiltFromTheRequest:
    def test_a_domain_refusal_comes_out_as_itself(self) -> None:
        with (
            pytest.raises(InvalidReferencePeriodError, match="ends before it begins") as refused,
            built_from_the_request(),
        ):
            ReferencePeriod(start=NEW_YEARS_EVE, end=NEW_YEARS_DAY)

        assert isinstance(refused.value.__cause__, ValidationError), "the wrapper is kept as cause"

    def test_a_refusal_from_a_nested_field_comes_out_as_itself(self) -> None:
        with pytest.raises(MalformedIdentifierError), built_from_the_request():
            a_household(home_country_candidate="Romania")

    def test_a_refusal_from_a_whole_record_check_comes_out_as_itself(self) -> None:
        with pytest.raises(HouseholdPlaceError, match="madrid"), built_from_the_request():
            a_household(home_city_candidate="city.spain.madrid")

    def test_a_native_constraint_failure_stays_a_validation_error(self) -> None:
        """A bound the request body should have mirrored: a 500 that says the body is wrong."""
        with pytest.raises(ValidationError), built_from_the_request():
            ScaleAnchor(input_value=Decimal(0), score=-1)

    def test_a_mapped_refusal_beside_a_native_failure_stays_a_validation_error(self) -> None:
        """Only when every problem is one the table maps is the first of them the answer;
        otherwise the 422 would describe part of what is wrong and hide the rest."""
        with pytest.raises(ValidationError), built_from_the_request():
            a_household(home_country_candidate="Romania", citizenships=frozenset())

    def test_an_unmapped_refusal_is_left_alone(self) -> None:
        with pytest.raises(ValidationError), built_from_the_request():
            Unmapped(figure=1)

    def test_a_non_validation_error_passes_through(self) -> None:
        with pytest.raises(KeyError), built_from_the_request():
            raise KeyError("not a refusal at all")

    def test_nothing_raised_is_nothing_changed(self) -> None:
        with built_from_the_request():
            period = ReferencePeriod(start=NEW_YEARS_DAY, end=NEW_YEARS_EVE)

        assert period.start == NEW_YEARS_DAY


class TestTheRefusalsTheTableGained:
    @pytest.mark.parametrize(
        ("error", "refusal"),
        [
            (MalformedIdentifierError("Eurostat"), (422, "invalid_request")),
            (ThresholdShapeError("minimum 50 is above maximum 10"), (422, "invalid_criterion")),
            (InvalidReferencePeriodError("backwards"), (422, "invalid_reference_period")),
        ],
        ids=["a malformed identifier", "a threshold of no shape", "a backwards period"],
    )
    def test_the_three_new_classes_have_a_refusal(
        self, error: Exception, refusal: tuple[int, str]
    ) -> None:
        assert refusal_for(error) == refusal
