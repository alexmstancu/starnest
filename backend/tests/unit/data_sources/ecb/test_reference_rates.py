"""The ECB's euro reference rates, read into the direction a stored conversion uses (ST-18, D63).

Driven through a stub transport, never the network. `captured/` holds a body in the shape the
ECB's data API answers `format=csvdata` with; whether the API still answers in it is what the
live test (`tests/live/test_ecb_reference_rates.py`) is for.
"""

from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from starnest.data import EURO, FxRateUnavailableError
from starnest.data_sources.ecb import EcbReferenceRates

CAPTURED = (Path(__file__).parent / "captured" / "exr_d_ron_eur.csv").read_text()


def rates_answering(
    body: str = CAPTURED, *, status: int = 200, seen: list[httpx.Request] | None = None
) -> EcbReferenceRates:
    def answer(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, text=body)

    return EcbReferenceRates(httpx.AsyncClient(transport=httpx.MockTransport(answer)))


async def test_a_published_rate_is_restated_as_one_unit_of_the_currency_in_euro() -> None:
    """The ECB publishes 1 EUR = 5.0750 RON; a conversion multiplies RON by the inverse."""
    rate = await rates_answering().rate_for(
        base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26)
    )

    assert (rate.base_currency, rate.quote_currency) == ("RON", EURO)
    assert rate.rate == Decimal("0.1970443350")
    assert rate.rate_date == date(2026, 6, 26)
    assert rate.data_source == "ecb"


async def test_a_day_with_no_rate_is_answered_with_the_last_one_published_before_it() -> None:
    """Sunday 28 June has no reference rate; Friday's is the one that applied."""
    rate = await rates_answering().rate_for(
        base_currency="RON", quote_currency=EURO, on=date(2026, 6, 28)
    )

    assert rate.rate_date == date(2026, 6, 26)


async def test_a_rate_published_after_the_day_asked_about_is_never_used() -> None:
    rate = await rates_answering().rate_for(
        base_currency="RON", quote_currency=EURO, on=date(2026, 6, 23)
    )

    assert (rate.rate_date, rate.rate) == (date(2026, 6, 23), Decimal("0.1972464397"))


async def test_the_request_names_the_series_and_a_window_ending_on_the_day() -> None:
    seen: list[httpx.Request] = []

    await rates_answering(seen=seen).rate_for(
        base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26)
    )

    (request,) = seen
    assert request.url.path.endswith("/EXR/D.RON.EUR.SP00.A")
    assert request.url.params["endPeriod"] == "2026-06-26"
    assert request.url.params["startPeriod"] < "2026-06-26"
    assert request.url.params["format"] == "csvdata"


@pytest.mark.parametrize(
    ("base", "quote"),
    [
        pytest.param("RON", "USD", id="a rate that does not quote the euro"),
        pytest.param(EURO, EURO, id="the euro against itself"),
    ],
)
async def test_a_pair_the_ecb_does_not_publish_is_refused_without_asking(
    base: str, quote: str
) -> None:
    seen: list[httpx.Request] = []

    with pytest.raises(FxRateUnavailableError, match="ECB"):
        await rates_answering(seen=seen).rate_for(
            base_currency=base, quote_currency=quote, on=date(2026, 6, 26)
        )
    assert seen == []


@pytest.mark.parametrize(
    ("body", "status"),
    [
        pytest.param("", 200, id="an empty body"),
        pytest.param(CAPTURED.splitlines()[0] + "\n", 200, id="a header and no rows"),
        pytest.param("No results found.", 404, id="no series for the window"),
        pytest.param("Service unavailable", 503, id="the service is down"),
    ],
)
async def test_an_answer_with_no_usable_rate_is_unavailable(body: str, status: int) -> None:
    """Never 1, never a guess: an invented rate is a wrong number with correct provenance."""
    with pytest.raises(FxRateUnavailableError, match="RON"):
        await rates_answering(body, status=status).rate_for(
            base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26)
        )


@pytest.mark.parametrize("unreadable", ["NaN", "", "n/a"])
async def test_a_row_with_no_readable_rate_is_skipped_for_the_one_before_it(
    unreadable: str,
) -> None:
    rates = rates_answering(CAPTURED.replace(",5.0750,", f",{unreadable},"))

    rate = await rates.rate_for(base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26))

    assert rate.rate_date == date(2026, 6, 25)


async def test_a_connection_that_never_opens_is_unavailable() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    rates = EcbReferenceRates(httpx.AsyncClient(transport=httpx.MockTransport(refuse)))

    with pytest.raises(FxRateUnavailableError, match="did not answer"):
        await rates.rate_for(base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26))
