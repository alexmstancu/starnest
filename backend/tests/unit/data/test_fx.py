"""The rate a conversion used, as a record with provenance rather than a division."""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    EURO,
    CurrencyMismatchError,
    FxRate,
    FxRateProvider,
    FxRateUnavailableError,
)

CHF_TO_EUR = FxRate(
    base_currency="CHF",
    quote_currency=EURO,
    rate_date=date(2026, 7, 1),
    rate=Decimal("1.05"),
    data_source="ecb",
)


class TestConverting:
    def test_restates_an_amount_in_the_quote_currency(self) -> None:
        assert CHF_TO_EUR.convert(Decimal("2900")) == Decimal("3045.00")

    def test_does_not_round(self) -> None:
        """What a figure should look like is a display decision, made once, elsewhere."""
        assert CHF_TO_EUR.convert(Decimal("1")) == Decimal("1.05")

    def test_carries_the_source_that_published_it(self) -> None:
        assert CHF_TO_EUR.data_source == "ecb"

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            CHF_TO_EUR.rate = Decimal("2")


class TestWhatARateRefuses:
    def test_refuses_a_pair_that_does_not_convert(self) -> None:
        with pytest.raises(ValidationError) as raised:
            FxRate(
                base_currency="EUR",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal("1"),
                data_source="ecb",
            )
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], CurrencyMismatchError)

    @pytest.mark.parametrize("rate", ["0", "-1.05"])
    def test_refuses_a_rate_that_is_not_positive(self, rate: str) -> None:
        with pytest.raises(ValidationError):
            FxRate(
                base_currency="CHF",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal(rate),
                data_source="ecb",
            )

    def test_refuses_a_rate_with_no_source(self) -> None:
        """One number in the system without provenance is exactly what 5.5 forbids."""
        with pytest.raises(ValidationError):
            FxRate(
                base_currency="CHF",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal("1.05"),
            )


class TestTheProviderSeam:
    def test_cannot_be_used_without_being_implemented(self) -> None:
        with pytest.raises(TypeError):
            FxRateProvider()  # type: ignore[abstract]

    async def test_an_implementation_may_answer_with_an_earlier_day(self) -> None:
        """Rates are not published on Sundays, and the answer says which day it is from."""

        class LastPublishedRate(FxRateProvider):
            async def rate_for(self, *, base_currency, quote_currency, on):
                if base_currency != "CHF":
                    raise FxRateUnavailableError(f"no rate for {base_currency}")
                return CHF_TO_EUR

        provider = LastPublishedRate()
        rate = await provider.rate_for(
            base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 5)
        )
        assert rate.rate_date == date(2026, 7, 1)
        with pytest.raises(FxRateUnavailableError):
            await provider.rate_for(base_currency="HUF", quote_currency=EURO, on=date(2026, 7, 5))
