"""The rate a conversion used, kept as data rather than as an implementation detail.

`reqs.md` 5.5. A monetary figure is stored exactly as issued and a EUR equivalent is stored
beside it, referencing the rate that produced it: the pair, the date, the number and the source
that published it.

**Why the rate is a record and not a division done in passing.** Storing only the converted
figure would leave the one number in the system without provenance, and would let two values
converted hours apart on the same day carry different rates -- making a cost comparison quietly
wrong. One rate per pair per day, sourced and dated, keeps every conversion internally
consistent and auditable.
"""

from abc import ABC, abstractmethod
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.data.identifiers import CurrencyCode, DataSourceId

EURO = CurrencyCode("EUR")
"""The currency every monetary value is also expressed in.

Not a preference and not a default: `value_monetary.amount_eur` is a column, so one currency
is structural to the schema. Everything *else* about money -- which currencies exist, which
rate applies -- is data.
"""


class FxRateUnavailableError(LookupError):
    """No published rate is available for a currency pair on a date."""


class CurrencyMismatchError(ValueError):
    """A rate was applied to an amount it does not convert."""


class FxRate(BaseModel):
    """One published exchange rate: `1 base_currency = rate quote_currency`, on `rate_date`.

    The direction is fixed by that reading and is the only one this module will apply. An
    inverted rate is a different record with the currencies swapped, not the same record
    read backwards -- inverting silently is how a conversion ends up off by the square of the
    rate with nothing looking broken.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    base_currency: CurrencyCode
    quote_currency: CurrencyCode
    rate_date: date = Field(description="The day the rate was published for. One rate per day.")
    rate: Decimal = Field(gt=0, allow_inf_nan=False)
    data_source: DataSourceId = Field(
        description="Who published it. A rate without one is a guess."
    )

    @model_validator(mode="after")
    def _reject_a_pair_that_does_not_convert(self) -> "FxRate":
        if self.base_currency == self.quote_currency:
            raise CurrencyMismatchError(
                f"{self.base_currency} to {self.quote_currency} is not a conversion"
            )
        return self

    def convert(self, amount: Decimal) -> Decimal:
        """`amount`, expressed in the base currency, restated in the quote currency.

        Not rounded. What a figure should look like is a display decision, and rounding here
        would bake one screen's answer into every stored value.
        """
        return amount * self.rate


class FxRateProvider(ABC):
    """The seam `data` declares for exchange rates (`arch.md` 6.3), implemented in `data_sources`.

    Nothing about where rates come from belongs in the domain: the ECB publishes on working
    days, a request may fall on a Sunday, and an implementation may legitimately answer with
    the most recent rate published on or before the day asked for. That is why the returned
    `FxRate` carries its own `rate_date` rather than echoing the requested one -- the answer
    says which day it is actually from, and the value stores that.
    """

    @abstractmethod
    async def rate_for(
        self, *, base_currency: CurrencyCode, quote_currency: CurrencyCode, on: date
    ) -> FxRate:
        """The rate for one pair, on or before `on`.

        Raises `FxRateUnavailableError` when no rate can be supplied. It never returns 1 for
        an unknown pair: an invented rate is a wrong number with correct-looking provenance,
        which is the failure this application exists to avoid.
        """
