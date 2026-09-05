"""Which Eurostat dataset answers which of our attributes, and with which slice.

**Everything here is a fact about Eurostat**, which is what makes it belong to the adapter
rather than to the catalog. The dataset code, and the filters that pick the headline series out
of a cube with sixteen age bands and three income groups, are Eurostat's own vocabulary; the
attribute the figures land on is ours.

**What is deliberately not here**: what shape the figure takes. Whether an attribute is a Ratio
of households or a Quantity in ladder points is catalog data, read off the `Attribute` the
adapter is given (`arch.md` 1.2). Restating it here would make adding an attribute a code
change, which is the one thing "nothing hardcoded" exists to prevent.

The filters matter more than they look. `ilc_lvho05a` unfiltered returns 5,027 observations
across every age band and income group; filtered to the totals it returns 840, and only the
totals are the indicator `reqs.md` 7.1 names.
"""

from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId


class EurostatQuery:
    """One dataset, and the slice of it that is the headline series."""

    __slots__ = ("dataset", "filters")

    def __init__(self, dataset: str, **filters: str) -> None:
        self.dataset = dataset
        self.filters = MappingProxyType(dict(filters))

    def __repr__(self) -> str:
        return f"EurostatQuery({self.dataset!r}, {dict(self.filters)!r})"


QUERIES: Final = MappingProxyType(
    {
        AttributeId("country.housing_cost_overburden_rate"): EurostatQuery(
            "ilc_lvho07a", freq="A", unit="PC", rskpovth="TOTAL", age="TOTAL", sex="T"
        ),
        AttributeId("country.overcrowding_rate"): EurostatQuery(
            "ilc_lvho05a", freq="A", unit="PC", rskpovth="TOTAL", age="TOTAL", sex="T"
        ),
        AttributeId("country.life_satisfaction"): EurostatQuery(
            "ilc_pw01",
            freq="A",
            statinfo="AVG",
            unit="RTG",
            isced11="TOTAL",
            life_sat="LIFE",
            sex="T",
            age="Y_GE16",
        ),
    }
)
"""Three of the fourteen attributes `reqs.md` 7.1 names Eurostat for.

Three rather than fourteen because `docs/mine2e.md` M2 asks for a real adapter rather than a
complete one, and because these three are verified to return figures for most of the 32
candidates. Two are Ratios and one is a Quantity, so both payload paths are exercised by real
data rather than by a fixture invented to exercise them.
"""

BASE_URL: Final = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
"""Free, unauthenticated, no quota. No key reaches this file, and none is needed."""
