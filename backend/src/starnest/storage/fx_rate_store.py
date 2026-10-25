"""Published exchange rates, as `fx_rate` holds them (`0001`, `0112`, `0521`)."""

from datetime import date

from psycopg_pool import AsyncConnectionPool

from starnest.data import (
    CurrencyCode,
    DataSourceId,
    FxRate,
    FxRateStore,
    FxRateUnavailableError,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresFxRateStore(FxRateStore):
    """One rate per pair per day, recorded once and never edited."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_rate(
        self, *, base_currency: CurrencyCode, quote_currency: CurrencyCode, on: date
    ) -> FxRate:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_fx_rate(
                connection,
                base_currency=str(base_currency),
                quote_currency=str(quote_currency),
                rate_date=on,
            )
        if row is None:
            raise FxRateUnavailableError(
                f"no {base_currency} to {quote_currency} rate is on record for {on}"
            )
        return FxRate(
            base_currency=CurrencyCode(row.base_currency),
            quote_currency=CurrencyCode(row.quote_currency),
            rate_date=row.rate_date,
            rate=row.rate,
            data_source=DataSourceId(row.data_source),
        )

    async def record_rate(self, rate: FxRate) -> FxRate:
        """Insert, or leave the rate already on record; either way, return the one that stands.

        Read back after the insert commits, so what comes back is the row on record -- the one
        just written, or the one it deferred to.
        """
        async with acquire(self._pool) as connection:
            await self._queries.insert_fx_rate(
                connection,
                base_currency=str(rate.base_currency),
                quote_currency=str(rate.quote_currency),
                rate_date=rate.rate_date,
                rate=rate.rate,
                data_source=str(rate.data_source),
            )
        return await self.read_rate(
            base_currency=rate.base_currency, quote_currency=rate.quote_currency, on=rate.rate_date
        )
