"""Eurostat: the source the catalog was designed around.

`eurostat` is the named source for 14 of the 41 country attributes in `reqs.md` 7.1, several of
which are literally Eurostat indicator codes. It is free, unauthenticated, and publishes raw
indicators rather than a composite -- which matters, because `reqs.md` forbids ingesting another
product's interpretation as a scoring input.
"""

from starnest.data_sources.eurostat.adapter import EurostatAdapter
from starnest.data_sources.eurostat.geography import eurostat_code_for
from starnest.data_sources.eurostat.jsonstat import JsonStatError, Observation, observations
from starnest.data_sources.eurostat.manifest import BASE_URL, QUERIES
from starnest.data_sources.eurostat.tax_wedge import (
    EUROSTAT_ESTIMATE,
    TaxWedgeEstimateAdapter,
)

__all__ = [
    "BASE_URL",
    "EUROSTAT_ESTIMATE",
    "QUERIES",
    "EurostatAdapter",
    "JsonStatError",
    "Observation",
    "TaxWedgeEstimateAdapter",
    "eurostat_code_for",
    "observations",
]
