"""What the Copernicus Climate Data Store is asked, and for which of our attributes.

**Everything here is a fact about the CDS dataset `sis-ecde-climate-indicators`**, the data
behind the European Climate Data Explorer. `hot_days` is their vocabulary;
`country.projected_summer_heat_days` is ours. What shape the figure takes -- a `Quantity` in
`days_per_year` -- is catalog data, read off the `Attribute`, so adding an attribute stays a pure
data change (`arch.md` 1.2).

**Two honest substitutions, both decided with the household (2026-10-07) and anticipated by
`datasources.md`:**

- **Scenario: `rcp4_5`, not SSP2-4.5.** This dataset offers `historical`, `rcp4_5`, `rcp8_5` and
  `ssp5_8_5`; SSP2-4.5 is not among them for temperature indicators. RCP4.5 is its AR5
  counterpart -- the same ~4.5 W/m2 stabilisation pathway -- and the provenance says so rather
  than claiming SSP2-4.5.
- **Definition: hot days above 30 C, not "summer days" above 25 C.** The ETCCDI 25 C index is
  not published here; 30 C is this dataset's (and the EEA's) pan-Europe heat measure.

**The figure describes a 30-year window, not a single year.** A projection is a climate normal,
so one year carries no meaning on its own; the adapter averages the years in `HORIZON` and the
members of the EURO-CORDEX ensemble, and stamps the window as the reference period.

**VERIFY ON FIRST LIVE FETCH.** The exact `inputs` the execute endpoint requires (above all the
ensemble member keys) and the CSV column names (`response.py`) are not published in a form that
could be confirmed without a CDS account. They are pinned here and in `response.py` as named
constants precisely so the first real fetch corrects one place, loudly, rather than mis-parsing
quietly -- `response.py` raises when the columns are not what it expects.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

DATASET: Final = "sis-ecde-climate-indicators"
"""The C3S dataset id, used as the process id in the execute URL."""

BASE_URL: Final = "https://cds.climate.copernicus.eu/api/retrieve/v1"
"""The CDS retrieve API root. Authenticated with a Personal Access Token in a `PRIVATE-TOKEN`
header -- a free CDS account, not a paid key, so `costs_money` stays False."""

# The one attribute this source answers, and the request that answers it. A tuple of (key, value)
# pairs rather than a bare dict so the request is immutable and reads as configuration.
HOT_DAYS_REQUEST: Final = MappingProxyType(
    {
        "variable": "hot_days",
        "origin": "projections",
        "experiment": "rcp4_5",
        "temporal_aggregation": "yearly",
        "spatial_aggregation": "regional_layer",
        "regional_layer": "nuts_level_0",
        "other_parameters": "30_c",
        "version": "v2_0",
    }
)
"""The execute `inputs` for the hot-days-above-30 C projection at country (NUTS0) level.

Ensemble-member keys (`gcm`, `rcm`, `ensemble_member`) are deliberately omitted: a request that
names none is expected to return the whole ensemble, which is what `response.py` then averages.
If the live API requires them, this is the one place to add them (VERIFY ON FIRST LIVE FETCH)."""

INDICATORS: Final = MappingProxyType(
    {
        AttributeId("country.projected_summer_heat_days"): HOT_DAYS_REQUEST,
    }
)
"""Our attribute -> the CDS request that answers it. One entry today; a second CDS indicator
would be a row here and a catalog row, nothing more."""

HORIZON_START_YEAR: Final = 2041
HORIZON_END_YEAR: Final = 2070
"""The projection window the figure describes: the standard mid-century climate-normal period.
Chosen with the household on 2026-10-07 over near-term (2021-2050) and end-century (2071-2100),
as the sensible horizon for an open-ended relocation. The reference period stored is these years."""

SCENARIO_PROVENANCE: Final = "RCP4.5 (EURO-CORDEX), the AR5 counterpart of SSP2-4.5"
THRESHOLD_PROVENANCE: Final = "days per year with daily maximum temperature above 30 C"
ENSEMBLE_PROVENANCE: Final = "mean over the nine bias-corrected EURO-CORDEX simulations"
"""Three sentences stamped into every figure's quote, so a reader sees what was actually asked:
the scenario standing in for SSP2-4.5, the indicator definition, and the ensemble reduction."""
