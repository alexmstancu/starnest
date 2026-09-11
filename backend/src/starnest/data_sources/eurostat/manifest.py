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


class EurostatShare:
    """A share assembled from components of one dataset: the parts over the whole, in percent.

    **For a figure Eurostat publishes only in pieces.** The effective tax rate is not a series of
    its own; `earn_nt_net` publishes gross earnings, taxes and social contributions separately,
    and the rate is what they make together. Each component is fetched as its own slice -- the
    JSON-stat decoder drops every dimension but place and period, so asking for all three at once
    would return figures with nothing to say which was which.

    **The components must come from the same year.** A country whose taxes are published for
    2025 and whose gross earnings stop at 2024 has no 2025 rate: dividing one year by another
    would produce a plausible number describing no year at all. The adapter only divides where
    every component has the same period, which is the same rule `reqs.md` 3.6 applies to a
    single figure's reference date.
    """

    __slots__ = ("dataset", "filters", "parts", "split_by", "whole")

    def __init__(
        self, dataset: str, *, split_by: str, parts: tuple[str, ...], whole: str, **filters: str
    ) -> None:
        self.dataset = dataset
        self.split_by = split_by
        self.parts = parts
        self.whole = whole
        self.filters = MappingProxyType(dict(filters))

    def slice_for(self, component: str) -> EurostatQuery:
        """The single-series query that fetches one component."""
        return EurostatQuery(self.dataset, **dict(self.filters), **{self.split_by: component})

    def __repr__(self) -> str:
        return (
            f"EurostatShare({self.dataset!r}, {' + '.join(self.parts)} of {self.whole}, "
            f"{dict(self.filters)!r})"
        )


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
        AttributeId("country.tech_employment_share"): EurostatQuery(
            "isoc_sks_itspt", freq="A", unit="PC_EMP"
        ),
        AttributeId("country.broadband_coverage"): EurostatQuery(
            "isoc_cbs",
            freq="A",
            unit="PC_HH",
            terrtypo="TOTAL",
            inet_spd="MBPS_GT100",
        ),
        AttributeId("country.protected_land_share"): EurostatQuery(
            "sdg_15_20", freq="A", unit="PC", areaprot="TPA"
        ),
        AttributeId("country.homicide_rate"): EurostatQuery(
            "sdg_16_10", freq="A", unit="RT", icd10="X85-Y09_Y871", sex="T", age="TOTAL"
        ),
        AttributeId("country.cost_of_living_index"): EurostatQuery(
            "tec00120", freq="A", indic_ppp="PLI_EU27_2020", ppp_cat18="E011"
        ),
        AttributeId("country.income_tax_effective"): EurostatShare(
            "earn_nt_net",
            split_by="estruct",
            parts=("TAX", "SOC"),
            whole="GRS",
            freq="A",
            currency="EUR",
            ecase="P1_NCH_AW100",
        ),
    }
)
"""Nine attributes, two of which arrived by fixing the catalog rather than by finding a source.

The first three were minE2E's: two Ratios and a Quantity, so both payload paths are exercised
by real data rather than by a fixture invented to exercise them. The last three are P4's W4-F,
chosen because each opens a pillar nothing had answered -- career, connectivity and nature --
rather than deepening housing, which already had two of its three (`devplan.md` D7).

**`income_tax_effective` is retired (`0445`, Q205) and this entry is inert** -- acquisition
reads active attributes only. It measured the employee's side over gross, which penalised
countries that put contributions on the employee; the total tax rate replaced it. The entry
stays because its three components -- gross, taxes, employee contributions -- are what the total
rate is computed from for the five EU members OECD does not cover, and it is rewired to that
next.

**`earn_nt_net` answered `income_tax_effective` for 31 of 32, where OECD answers 26.** It is
built on the same joint EU-OECD tax-benefit model as OECD's Taxing Wages, and it covers the
five EU members OECD does not -- **including Romania**, which is the comparison anchor.
The rate is income tax plus employee social contributions over gross earnings, for a single
person without children on the average wage (`P1_NCH_AW100`, the reference case both
publishers use). Romania comes out at 41.5%, which is what its law gives: 35% employee
contributions, then 10% income tax on the remaining 65%.

The household case is a provisional choice like every default here. `reqs.md` Q84 says costs
mean something only against the household's own situation, and `ecase` is exactly where that
would plug in -- couples, children, other income levels are all published -- once the
household reaches evaluation, which is post-MVP.

**`tec00120` answers an attribute that could not hold a value until 2026-09-09.**
`cost_of_living_index` was typed `Index` and declared no bounds, so nothing could be stored
against it at all; migration `0443` retyped it as a `Quantity` whose unit names the base. The
figure is a price level relative to the EU27 average -- Romania 65.1, Germany 108.3, Iceland
173.5 -- and the absence of any ceiling is exactly why `Index` was the wrong type.

**`sdg_16_10` replaced a source nobody could reach.** `country.homicide_rate` was created by
migration `0442` out of `crime_safety_index`, whose rank-1 source was UNODC -- a portal download
rather than an API -- and whose declared bounds were Numbeo's, behind a $50-500/month
subscription. Eurostat was rank 2 all along and answers all 32. It publishes a **standardised
death rate** from cause-of-death statistics rather than police-recorded offences, which is the
better indicator anyway: recording practice varies enormously between countries, so
police-recorded crime partly measures the recording.

**`sdg_15_20` answers 27 of the 32 candidates, and the five it misses are the honest kind.**
Switzerland, Iceland, Liechtenstein, Norway and the United Kingdom are outside the EU reporting
this series is built on. They arrive as coverage rather than as a failure, which is what
`reqs.md` 5.3 asks for -- and is a better outcome than a figure assembled from somewhere else
and presented as though it were the same measurement.

**`isoc_cbs` asks for coverage at 100 Mbit/s, and that is a judgement rather than a lookup.**
The dataset offers five thresholds, and the obvious assumption -- that 30 Mbit/s is saturated
across Europe and would discriminate nothing -- is simply false: its spread across the 32
candidates is 36.6 points against 100 Mbit/s's 37.6, and its floor is 63.4%. Neither threshold
can be chosen on spread, so it is chosen on meaning. 100 Mbit/s is the EU's own very-high-
capacity line and the honest reading of "could somebody work from here". Gigabit spreads widest
of the three but measures an ambition rather than a requirement.
"""

BASE_URL: Final = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
"""Free, unauthenticated, and the guidelines publish no quota. No key reaches this file.

`format=JSON` is the only value the API supports and `lang` defaults to EN; both are sent
explicitly anyway, because a default that changes is a response that changes.
"""

# --- What the catalogue API offers, and why none of it is used yet ---------------------------
#
# Eurostat publishes a catalogue alongside the data
# (`/api/dissemination/catalogue/`): a table of contents, a DCAT feed of UPDATES only, and a
# metabase listing every dataset's dimensions. Three things it would buy, none of them needed
# for the work in hand:
#
#   * **Verifying these dataset codes still exist**, which the `live` test currently infers from
#     a successful fetch.
#   * **Fetching only what changed.** Datasets are refreshed twice a day, at 11:00 and 23:00
#     Europe/Brussels, so a full sweep re-downloads mostly unchanged series.
#   * **Discovering a dataset's dimensions** rather than reading them off a captured response,
#     which is how the filters below were found.
#
# Left unbuilt deliberately: re-fetch scheduling is `reqs.md` 6.6's question and nothing asks it
# yet, and a catalogue reader with no caller would be code written to be exported.
