"""Somebody else's conclusion, kept where it cannot be summed by accident."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    ExternalScore,
    MalformedExternalScoreError,
    ReferencePeriod,
    Value,
)

RETRIEVED = datetime(2026, 8, 1, tzinfo=UTC)


def a_published_score(**overrides: object) -> ExternalScore:
    fields: dict[str, object] = {
        "candidate": "country.portugal",
        "data_source": "numbeo",
        "published_scale": "0-100",
        "published_value": Decimal("74.3"),
        "reference_period": ReferencePeriod.covering_year(2026),
        "retrieval_date": RETRIEVED,
    }
    return ExternalScore(**(fields | overrides))


class TestWhatAPublishedScoreHolds:
    def test_holds_a_number_and_the_scale_that_makes_it_mean_something(self) -> None:
        score = a_published_score(methodology_url="https://numbeo.com/method", caveats="Paywalled")
        assert score.published_value == Decimal("74.3")
        assert score.published_scale == "0-100"
        assert score.methodology_url == "https://numbeo.com/method"

    def test_holds_a_position_where_the_provider_publishes_one(self) -> None:
        score = a_published_score(
            published_value=None, published_scale="rank", published_rank=12, published_rank_of=95
        )
        assert (score.published_rank, score.published_rank_of) == (12, 95)

    def test_names_the_provider_as_a_source_rather_than_as_a_string(self) -> None:
        """Numbeo supplies both values and a composite; one row means one reliability tier."""
        assert a_published_score().data_source == "numbeo"

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score().published_value = Decimal("99")


class TestItIsNotAValue:
    def test_is_a_separate_type_entirely(self) -> None:
        """A flag on `Value` gets forgotten in a join and silently ends up inside a sum."""
        assert not issubclass(ExternalScore, Value)

    def test_carries_no_payload_that_scoring_could_read(self) -> None:
        assert "payload" not in ExternalScore.model_fields
        assert "value_type" not in ExternalScore.model_fields


class TestWhatItRefuses:
    def test_refuses_a_score_that_publishes_neither_value_nor_rank(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_published_score(published_value=None)
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedExternalScoreError)

    def test_refuses_a_position_with_no_field_to_be_positioned_in(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_value=None, published_rank=12)

    def test_refuses_being_twelfth_of_five(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_value=None, published_rank=12, published_rank_of=5)

    def test_refuses_a_retrieval_date_with_no_timezone(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(retrieval_date=datetime(2026, 8, 1))

    def test_refuses_a_scale_that_says_nothing(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_scale="")
