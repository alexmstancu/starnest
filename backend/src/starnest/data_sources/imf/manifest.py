"""Which IMF indicator answers which of our attributes, and which year of it.

**Everything here is a fact about the World Economic Outlook.** `NGDP_RPCH` is the IMF's
vocabulary; `country.economic_outlook` is ours.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

INDICATORS: Final = MappingProxyType(
    {
        AttributeId("country.economic_outlook"): "NGDP_RPCH",
    }
)
"""Real GDP growth, the WEO headline series, which `reqs.md` 7.1 names the IMF for."""

BASE_URL: Final = "https://www.imf.org/external/datamapper/api/v1"
"""Free, unauthenticated, no key. No key reaches this file."""

YEARS_AHEAD: Final = 1
"""How far into the forecast to read: next year, not the furthest year published.

**The choice this adapter turns on.** WEO publishes actuals and projections in one series
running five or six years past the present -- 1980 to 2031 as of this writing -- so "the newest
year", the rule every other adapter here uses, would take a forecast half a decade out. Those
exist for modelling, not for deciding where to live: the 2031 figure for most of Europe is a
long-run growth assumption barely distinguishable between countries, while next year's carries
actual information.

The response marks no boundary between actual and projection, so this cannot be derived and is
stated instead. It is provisional in the way every threshold in this project is (`CLAUDE.md`,
Conventions), and the reference period records which year was read, so a figure is never
mistaken for the current one.
"""
