"""The OECD, for the total tax rate: every component a country levies, compared like for like.

Reached through `stats.oecd.org`'s SDMX-JSON service. Keyed on ISO alpha-3.
"""

from starnest.data_sources.oecd.adapter import OECD, OecdAdapter
from starnest.data_sources.oecd.manifest import BASE_URL, SERIES, OecdSeries
from starnest.data_sources.oecd.response import OecdError, figures

__all__ = ["BASE_URL", "OECD", "SERIES", "OecdAdapter", "OecdError", "OecdSeries", "figures"]
