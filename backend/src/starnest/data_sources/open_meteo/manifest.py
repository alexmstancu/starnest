"""Which Open-Meteo variable answers which attribute, and the terms a run must keep to.

Facts about Open-Meteo, so they belong to the adapter: the archive endpoint, the variable names,
and the free tier's arithmetic. What shape a figure takes -- a Quantity in celsius -- is read off
the catalog's `Attribute`, as every adapter does.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

BASE_URL: Final = "https://archive-api.open-meteo.com/v1/archive"

VARIABLES: Final = MappingProxyType(
    {AttributeId("country.avg_annual_temperature"): "temperature_2m_mean"}
)
"""Temperature, and only temperature.

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
