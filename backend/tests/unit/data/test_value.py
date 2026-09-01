"""One measurement, and the things it may not claim about itself.

The two dates get their own class here. They are the field pair most likely to be quietly
merged by a later refactor, and merging them is exactly what `reqs.md` 3.6 forbids.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    Boolean,
    ConfidenceLevel,
    MalformedValueError,
    Monetary,
    Quantity,
    ReferencePeriod,
    Value,
    ValueType,
)

JULY = ReferencePeriod(start=datetime(2026, 7, 1).date(), end=datetime(2026, 7, 31).date())
FETCHED = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)


def a_value(**overrides: object) -> Value:
    fields: dict[str, object] = {
        "candidate": "country.portugal",
        "attribute": "country.rent_centre",
        "value_type": ValueType.MONETARY,
        "data_source": "numbeo",
        "reference_period": JULY,
        "retrieval_date": FETCHED,
        "confidence_level": ConfidenceLevel.MEDIUM,
        "payload": Monetary.in_euro(Decimal("1410")),
    }
    return Value(**(fields | overrides))


class TestWhatAValueCarries:
    def test_holds_a_figure_and_where_it_came_from(self) -> None:
        value = a_value(quote="Numbeo, July 2026", citations=("https://numbeo.com/rent",))
        assert value.data_source == "numbeo"
        assert value.quote == "Numbeo, July 2026"
        assert value.citations == ("https://numbeo.com/rent",)

    def test_carries_no_citations_until_it_is_given_some(self) -> None:
        assert a_value().citations == ()

    def test_has_no_identifier_until_the_database_gives_it_one(self) -> None:
        assert a_value().id is None
        assert a_value(id=9001).id == 9001

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            a_value().confidence_level = ConfidenceLevel.HIGH

    def test_has_no_field_saying_it_is_active(self) -> None:
        """Being active is a comparison between values, so it is computed, never stored."""
        assert "is_active" not in Value.model_fields

    def test_knows_nothing_about_criteria_sets_or_scores(self) -> None:
        forbidden = {"score", "weight", "criteria_set", "rank", "match_status"}
        assert forbidden.isdisjoint(Value.model_fields)


class TestTheTwoDates:
    def test_keeps_the_span_it_describes_apart_from_the_moment_it_was_fetched(self) -> None:
        value = a_value()
        assert value.reference_period.start != value.retrieval_date.date()
        assert isinstance(value.reference_period, ReferencePeriod)
        assert isinstance(value.retrieval_date, datetime)

    def test_refuses_a_retrieval_date_with_no_timezone(self) -> None:
        """Every moment the system records is a `timestamptz` (`arch.md` 9.6)."""
        with pytest.raises(ValidationError) as raised:
            a_value(retrieval_date=datetime(2026, 8, 1, 9, 30))
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedValueError)

    def test_refuses_a_reference_period_that_ends_before_it_starts(self) -> None:
        with pytest.raises(ValidationError):
            a_value(reference_period={"start": "2026-07-31", "end": "2026-07-01"})


class TestWhatAValueMayNotClaim:
    def test_refuses_a_payload_of_another_type(self) -> None:
        """Zurich's rent stored as a count would be 2900 with no currency, and the ranking
        would report a gap that is simply wrong with nothing looking broken."""
        with pytest.raises(ValidationError) as raised:
            a_value(value_type=ValueType.BOOLEAN, payload=Monetary.in_euro(Decimal("2900")))
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedValueError)

    def test_refuses_an_attribute_measured_at_another_level(self) -> None:
        with pytest.raises(ValidationError):
            a_value(candidate="city.portugal.lisbon")

    def test_refuses_to_hold_nothing_without_saying_why(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_value(payload=None)
        assert "must carry the reason" in str(raised.value)

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            a_value(is_active=True)


class TestRejection:
    def test_a_figure_that_could_not_be_stored_keeps_its_reason_and_no_payload(self) -> None:
        """A share composition that does not sum has no payload any table would accept."""
        rejected = a_value(payload=None, rejection_reason="the shares sum to 93, not 100")
        assert rejected.is_rejected
        assert rejected.payload is None

    def test_a_figure_outside_the_credible_range_keeps_the_number_it_was(self) -> None:
        """Nothing is discarded: the rejected figure stays visible with its reason."""
        rejected = a_value(rejection_reason="45000 is outside the credible range for rent")
        assert rejected.is_rejected
        assert rejected.payload == Monetary.in_euro(Decimal("1410"))

    def test_an_accepted_value_says_nothing_about_rejection(self) -> None:
        assert a_value().is_rejected is False
        assert a_value().rejection_reason is None


class TestBreakdownOptions:
    def test_three_rents_for_one_city_are_three_values(self) -> None:
        """None of them is history; they coexist and describe the attribute together."""
        rents = [
            a_value(breakdown_option=option, payload=Monetary.in_euro(amount))
            for option, amount in (
                ("one_bedroom", Decimal("1100")),
                ("two_bedroom", Decimal("1410")),
                ("three_bedroom", Decimal("1900")),
            )
        ]
        assert len({rent.breakdown_option for rent in rents}) == 3

    def test_a_value_for_an_attribute_that_is_not_broken_down_names_no_option(self) -> None:
        assert a_value().breakdown_option is None


class TestOtherPayloadsRideTheSameProvenance:
    @pytest.mark.parametrize(
        ("value_type", "payload"),
        [
            (ValueType.BOOLEAN, Boolean(value=True)),
            (ValueType.QUANTITY, Quantity(magnitude=Decimal("12.4"), unit="celsius")),
        ],
    )
    def test_any_type_may_be_stored_with_the_same_provenance(self, value_type, payload) -> None:
        value = a_value(attribute="country.coastal", value_type=value_type, payload=payload)
        assert value.payload == payload
