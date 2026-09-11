"""Which Open-Meteo variable answers which attribute, and the terms a run must keep to.

Facts about Open-Meteo, so they belong to the adapter: the archive endpoint, the variable names,
and the free tier's arithmetic. What shape a figure takes -- a Quantity in celsius -- is read off
the catalog's `Attribute`, as every adapter does.
"""

from datetime import date, timedelta
from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

BASE_URL: Final = "https://archive-api.open-meteo.com/v1/archive"


class ClimateSeries:
    """One daily variable, averaged over a window of months of the settled year.

    A window whose first month comes after its last starts in the previous year: December to
    February is one winter, the one that ends in the settled year. A year is January to December.
    """

    __slots__ = ("first_month", "last_month", "variable")

    def __init__(self, variable: str, *, first_month: int = 1, last_month: int = 12) -> None:
        self.variable = variable
        self.first_month = first_month
        self.last_month = last_month

    def window(self, year: int) -> tuple[date, date]:
        """The first and last day this series averages over, for the settled year."""
        first_year = year - 1 if self.first_month > self.last_month else year
        after_the_last = date(year + (self.last_month == 12), self.last_month % 12 + 1, 1)
        return date(first_year, self.first_month, 1), after_the_last - timedelta(days=1)

    def __repr__(self) -> str:
        return f"ClimateSeries({self.variable!r}, months {self.first_month}-{self.last_month})"


SERIES: Final = MappingProxyType(
    {
        AttributeId("country.avg_annual_temperature"): ClimateSeries("temperature_2m_mean"),
        AttributeId("country.summer_daytime_temperature"): ClimateSeries(
            "temperature_2m_max", first_month=6, last_month=8
        ),
        AttributeId("country.winter_daytime_temperature"): ClimateSeries(
            "temperature_2m_max", first_month=12, last_month=2
        ),
    }
)
"""The yearly average, and the average daily high of a summer and of a winter (Q213).

**Daytime, never the night**, as the household specified: the winter figure is how warm a
winter day gets, which is the daily high, not the night-time minimum.

**`annual_sunshine_hours` is deliberately absent.** Open-Meteo's `sunshine_duration` is derived
from ERA5's modelled radiation, not measured by sunshine recorders, and against the recorders'
long-run figures it runs high and unevenly: London +60%, Berlin +68%, Stockholm +52%, Madrid and
Lisbon about +30% (checked 2026-09-11). It squeezes the north-south difference that is the whole
point of the attribute, so it would be a plausible number in the wrong unit -- and the honest
answer is no figure (`reqs.md` 5.3). Its temperatures match the records closely.
"""

CALLS_PER_MINUTE: Final = 500
"""Below the free tier's 600, for margin. The tier also allows 5,000 an hour and 10,000 a day;
one full run is about 4,200 (32 countries, five places, a year each)."""

DAYS_PER_CALL: Final = 14
"""Open-Meteo counts a request as one call per place per two weeks of data (open-meteo.com
pricing): a year for five places is about 130 calls, not one."""

SETTLING_DAYS: Final = 90
"""How long ERA5 takes to become final. A year is only asked for once it has settled."""
