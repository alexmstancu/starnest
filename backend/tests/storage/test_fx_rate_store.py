"""Published exchange rates, recorded once per pair per day (ST-18, D63)."""

from datetime import date
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import EURO, FxRate, FxRateUnavailableError
from starnest.storage import PostgresFxRateStore

pytestmark = pytest.mark.storage

RON_ON_FRIDAY = FxRate(
    base_currency="RON",
    quote_currency=EURO,
    rate_date=date(2026, 6, 26),
    rate=Decimal("0.1970443350"),
    data_source="ecb",
)


@pytest.fixture
def rates(pool: AsyncConnectionPool) -> PostgresFxRateStore:
    return PostgresFxRateStore(pool)


async def test_a_recorded_rate_is_read_back_with_its_publisher(
    rates: PostgresFxRateStore,
) -> None:
    assert await rates.record_rate(RON_ON_FRIDAY) == RON_ON_FRIDAY

    assert (
        await rates.read_rate(base_currency="RON", quote_currency=EURO, on=date(2026, 6, 26))
        == RON_ON_FRIDAY
    )


async def test_a_rate_is_recorded_once_and_the_first_one_stands(
    rates: PostgresFxRateStore,
) -> None:
    """One rate per pair per day (`0001`): recording it again changes and refuses nothing."""
    await rates.record_rate(RON_ON_FRIDAY)

    again = await rates.record_rate(RON_ON_FRIDAY.model_copy(update={"rate": Decimal("0.2")}))

    assert again == RON_ON_FRIDAY


@pytest.mark.parametrize(
    ("currency", "on"),
    [
        pytest.param("RON", date(2026, 6, 27), id="another day"),
        pytest.param("CHF", date(2026, 6, 26), id="another currency"),
    ],
)
async def test_a_rate_not_on_record_is_unavailable(
    rates: PostgresFxRateStore, currency: str, on: date
) -> None:
    await rates.record_rate(RON_ON_FRIDAY)

    with pytest.raises(FxRateUnavailableError, match=currency):
        await rates.read_rate(base_currency=currency, quote_currency=EURO, on=on)
