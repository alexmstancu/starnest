"""The IMF, for the one forecast in the catalog.

Everything else this application stores is a measurement of something that already happened.
`country.economic_outlook` is not, and the difference is carried in two places rather than
argued about: the confidence is `medium` because a forecast is not a measurement, and the
reference period is the year being forecast, so nothing reads it as current.
"""

from starnest.data_sources.imf.adapter import IMF, ImfAdapter
from starnest.data_sources.imf.manifest import BASE_URL, INDICATORS, YEARS_AHEAD
from starnest.data_sources.imf.response import ImfError, Projection, projections

__all__ = [
    "BASE_URL",
    "IMF",
    "INDICATORS",
    "YEARS_AHEAD",
    "ImfAdapter",
    "ImfError",
    "Projection",
    "projections",
]
