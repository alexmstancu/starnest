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
models of the EURO-CORDEX ensemble, and stamps the window as the reference period.

**Confirmed against the live CDS on 2026-10-08.** The request below was validated end to end: the
execute endpoint accepts it, and asking for every valid `gcm`/`rcm`/`ensemble_member` value makes
the store compute the valid combinations itself and return one NetCDF file per model run (nine, on
that date) in a single zip. The data is **NetCDF, not CSV** -- `response.py` reads it with
`netCDF4` and averages across the nine models and the horizon years.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId

DATASET: Final = "sis-ecde-climate-indicators"
"""The C3S dataset id, used as the process id in the execute URL."""

BASE_URL: Final = "https://cds.climate.copernicus.eu/api/retrieve/v1"
"""The CDS retrieve API root. Authenticated with a Personal Access Token in a `PRIVATE-TOKEN`
header -- a free CDS account, not a paid key, so `costs_money` stays False."""

# The one attribute this source answers, and the request that answers it. Array-valued fields are
# tuples so the request is immutable and reads as configuration; the CDS expects JSON arrays and
# httpx serialises a tuple as one.
HOT_DAYS_REQUEST: Final = MappingProxyType(
    {
        "variable": ("hot_days",),
        "origin": "projections",
        "experiment": ("rcp4_5",),
        # Every valid model value for this indicator. The store intersects them to the model runs
        # that actually exist (nine on 2026-10-08) rather than us enumerating valid tuples, so a
        # model added to the dataset later joins the ensemble on its own.
        "gcm": ("ec_earth", "hadgem2_es", "ipsl_cm5a_mr", "mpi_esm_lr", "noresm1_m"),
        "rcm": ("cclm4_8_17", "hirham5", "racmo22e", "rca4", "wrf381p"),
        "ensemble_member": ("r12i1p1", "r1i1p1", "r3i1p1"),
        "temporal_aggregation": ("yearly",),
        "spatial_aggregation": "regional_layer",
        "regional_layer": ("nuts_level_0",),
        "other_parameters": ("30_c",),
        "version": "v2_0",
    }
)
"""The execute `inputs` for the hot-days-above-30 C projection at country (NUTS0) level, over the
whole EURO-CORDEX RCP4.5 ensemble. Confirmed valid against the live API 2026-10-08."""

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
ENSEMBLE_PROVENANCE: Final = (
    "mean over the full EURO-CORDEX RCP4.5 ensemble the dataset offers (nine runs on 2026-10-08)"
)
"""Three sentences stamped into every figure's quote, so a reader sees what was actually asked:
the scenario standing in for SSP2-4.5, the indicator definition, and the ensemble reduction."""
