"""The euro foreign exchange reference rates, from the ECB's data API (ST-18, D63).

**The ECB is the authority for a conversion's rate** (`0112`): it publishes one reference rate
per currency per working day, around 16:00 CET, free and without a key. Series
`EXR/D.<currency>.EUR.SP00.A` is the daily spot reference rate, read as CSV because the figures
are two columns of a flat table and SDMX-JSON's positional indexing would only add a way to
misread them.

**Published as 1 EUR = x <currency>, stored the other way round.** A stored conversion
multiplies the amount, in its own currency, by the rate to reach euro (`FxRate`, `Monetary`), so
the published figure is inverted here -- once, deliberately, to `SIGNIFICANT_DIGITS` -- and the
record says so by swapping the currencies rather than by reading one backwards. The publisher is
still the ECB: the stored figure is the published one restated, not an estimate.

**A day with no rate** -- a weekend, a TARGET holiday -- **is answered with the last working
day's**, and the record carries that day, so a figure says which day its rate is from.
"""

import csv
import io
from collections.abc import Iterator
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, localcontext

import httpx

from starnest.data import (
    EURO,
    CurrencyCode,
    DataSourceId,
    FxRate,
    FxRateProvider,
    FxRateUnavailableError,
)

ECB = DataSourceId("ecb")

BASE_URL = "https://data-api.ecb.europa.eu/service/data/EXR"

LOOK_BACK = timedelta(days=10)
"""How far before the day asked about a rate is looked for. The longest run of days without a
reference rate is Easter's four, so ten covers any holiday and a weekend beside it; a rate
older than that is not the one that applied, and is refused rather than used."""

SIGNIFICANT_DIGITS = 10
"""The inverted rate's precision. The ECB quotes four or five significant digits, so ten keeps
the inversion exact to well inside `FX_CONVERSION_TOLERANCE` -- and it survives a JSON number
unchanged, which is how a client hands the rate back when it types a converted amount."""


class EcbReferenceRates(FxRateProvider):
    """The ECB's published rate for a currency against the euro, on or before a day.

    Holds the client rather than making one: who opens the connection, with what timeout, is the
    composition root's business (`arch.md` 7.5), and a provider that built its own could not be
    tested without the network.
    """

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._client = client
        self._base_url = base_url

    async def rate_for(
        self, *, base_currency: CurrencyCode, quote_currency: CurrencyCode, on: date
    ) -> FxRate:
        if quote_currency != EURO or base_currency == EURO:
            raise FxRateUnavailableError(
                f"the ECB publishes euro reference rates, and {base_currency} to "
                f"{quote_currency} is not one"
            )
        published = dict(_rates_in(await self._series(base_currency, on)))
        days = [day for day in published if day <= on]
        if not days:
            raise FxRateUnavailableError(
                f"the ECB published no {base_currency} reference rate in the {LOOK_BACK.days} "
                f"days to {on}"
            )
        day = max(days)
        return FxRate(
            base_currency=base_currency,
            quote_currency=EURO,
            rate_date=day,
            rate=_one_unit_in_euro(published[day]),
            data_source=ECB,
        )

    async def _series(self, currency: CurrencyCode, on: date) -> str:
        """The CSV body for the window ending on `on`; every way it can fail is unavailable."""
        try:
            response = await self._client.get(
                f"{self._base_url}/D.{currency}.EUR.SP00.A",
                params={
                    "startPeriod": (on - LOOK_BACK).isoformat(),
                    "endPeriod": on.isoformat(),
                    "format": "csvdata",
                },
            )
        except httpx.HTTPError:
            raise FxRateUnavailableError(
                f"the ECB did not answer when asked for the {currency} reference rate"
            ) from None
        if response.status_code == httpx.codes.NOT_FOUND:
            # The data API's answer to a window with no observations in it.
            return ""
        if response.is_error:
            raise FxRateUnavailableError(
                f"the ECB refused the request for the {currency} reference rate "
                f"(HTTP {response.status_code})"
            )
        return response.text


def _rates_in(body: str) -> Iterator[tuple[date, Decimal]]:
    """Each day's published rate. A row without a readable, positive figure is skipped."""
    for row in csv.DictReader(io.StringIO(body)):
        try:
            day = date.fromisoformat(row.get("TIME_PERIOD") or "")
            figure = Decimal(row.get("OBS_VALUE") or "")
        except (ValueError, InvalidOperation):
            continue
        if figure.is_finite() and figure > 0:
            yield day, figure


def _one_unit_in_euro(euro_in_currency: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = SIGNIFICANT_DIGITS
        return Decimal(1) / euro_in_currency
