"""Which WHO indicator answers which of our attributes.

**Everything here is a fact about the Global Health Observatory.** `UHC_INDEX_REPORTED` is
their vocabulary; `country.healthcare_system_quality` is ours. What shape the figure takes --
an `Index` published 0 to 100 by "WHO UHC" -- is catalog data, read off the `Attribute`, so
adding an attribute stays a pure data change (`arch.md` 1.2).

**One attribute, and it opens a pillar.** Health is the only pillar in the catalog with a
single attribute, so this one indicator takes it from nothing to complete, and it is one of
the seven the shipped set will not score without (`devplan.md` D7).
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

INDICATORS: Final = MappingProxyType(
    {
        AttributeId("country.healthcare_system_quality"): "UHC_INDEX_REPORTED",
    }
)
"""The UHC Service Coverage Index, which `reqs.md` 7.1 names WHO for.

It is SDG indicator 3.8.1: the share of a population receiving the essential health services
they need, without financial hardship, scored 0 to 100. **A composite**, like the World Bank's
governance estimates, and here for the same reason -- `reqs.md` names it, and no comparable
pan-European raw measure of health system quality exists to prefer instead.
"""

BASE_URL: Final = "https://ghoapi.azureedge.net/api"
"""Free, unauthenticated, OData. No key reaches this file."""

A_COUNTRY: Final = "COUNTRY"
"""The value of `SpatialDimType` on a row that describes one country.

**The most important constant in this module.** The same response carries `REGION`, `GLOBAL`,
`WORLDBANKREGION` and `WORLDBANKINCOMEGROUP` rows -- 480 of 5,160 in the UHC series -- and
their `SpatialDim` values look exactly like country codes. A row for "EUR" ingested as a
country's own figure would be a plausible-looking number that describes somewhere else, which
is the failure `reqs.md` calls fabrication.
"""
