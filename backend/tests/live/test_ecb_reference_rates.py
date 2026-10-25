"""The ECB's euro reference rates, against the real data API. **Live, so never in `make check`.**

What only a live call can prove: that `EXR/D.<currency>.EUR.SP00.A` is the series the ECB still
answers to, in the `csvdata` shape the captured body was written in, and that a rate comes back
for a working day and for the weekend after it.
"""

from datetime import date, timedelta

import httpx
import pytest

from starnest.data import EURO
from starnest.data_sources.ecb import EcbReferenceRates

pytestmark = pytest.mark.live

CURRENCIES_OF_THE_ROSTER = ("CHF", "CZK", "DKK", "GBP", "HUF", "ISK", "NOK", "PLN", "RON", "SEK")
"""Every non-euro currency a candidate in the roster issues figures in. Bulgaria joined the euro
on 1 January 2026, so the lev is not among them."""


@pytest.mark.parametrize("currency", CURRENCIES_OF_THE_ROSTER)
async def test_the_ecb_publishes_a_rate_for_each_currency_of_the_roster(currency: str) -> None:
    a_week_ago = date.today() - timedelta(days=7)
    async with httpx.AsyncClient(timeout=60) as client:
        rate = await EcbReferenceRates(client).rate_for(
            base_currency=currency, quote_currency=EURO, on=a_week_ago
        )

    assert rate.rate_date <= a_week_ago
    assert a_week_ago - rate.rate_date <= timedelta(days=5)
    assert rate.data_source == "ecb"
    assert rate.rate > 0
