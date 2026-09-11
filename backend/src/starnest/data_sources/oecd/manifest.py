"""Which OECD series answers which of our attributes, picked out of a whole dataflow.

**Everything here is a fact about the OECD.** `AWCOMP` and `AV_TW` are its vocabulary;
`country.total_tax_rate_effective` is ours.

**A series is named by every dimension that distinguishes it, not by a code.** The Taxing Wages
dataflow crosses thirteen measures with four units, four household types, three income levels
and two spouse situations -- 4,768 series, of which exactly one per country is the figure
wanted. Naming fewer dimensions than that would leave several series matching, and the decoder
refuses rather than picking one, because picking would be choosing a household type nobody
chose.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId


class OecdSeries:
    """One dataflow, and the dimension values that pick one series per country out of it."""

    __slots__ = ("dataflow", "selection")

    def __init__(self, dataflow: str, **selection: str) -> None:
        self.dataflow = dataflow
        self.selection = MappingProxyType(dict(selection))

    def __repr__(self) -> str:
        return f"OecdSeries({self.dataflow!r}, {dict(self.selection)!r})"


SERIES: Final = MappingProxyType(
    {
        AttributeId("country.total_tax_rate_effective"): OecdSeries(
            "OECD.CTP.TPS,DSD_TAX_WAGES_COMP@DF_TW_COMP",
            MEASURE="AV_TW",
            UNIT_MEASURE="PT_COS_LB",
            HOUSEHOLD_TYPE="S_C0",
            INCOME_PRINCIPAL="AW167",
            FREQ="A",
        ),
    }
)
"""The average tax wedge, as a share of labour cost, for a single person at 167% of the average
wage (Q205).

Every component a country levies -- income tax, the employee's contributions, the employer's --
over the whole cost of employment, so a country that splits contributions differently is not
measured differently. 167% is the highest income step OECD models, where a progressive system
shows its bite: Belgium is 52.5% at the average wage and 58.6% here.
"""

BASE_URL: Final = "https://sdmx.oecd.org/public/rest/data"
"""OECD's SDMX REST service, which answers a script.

**Two earlier notes about this address were wrong, and both are worth keeping in mind.** The
first concluded from one Cloudflare-blocked path that no OECD adapter could work; only
`www.oecd.org` is blocked. The second, written with this module, called `stats.oecd.org` a
separate "legacy" service. It is not: it answers `301` to exactly this URL. Probes with
`curl -L` followed the redirect silently and looked like success; `httpx` does not follow
redirects, and the first live run failed on it. The dataflow is named here directly, so nothing
depends on a redirect that can be withdrawn.

The whole dataflow comes back -- about 2.8 MB for Taxing Wages -- and the series is selected by
the decoder, whose refusal of an ambiguous selection is the safety a server-side key would
otherwise have to provide.
"""
