"""Which World Bank series answers which of our attributes.

**Everything here is a fact about the World Bank**, which is what makes it belong to the adapter
rather than to the catalog. `GOV_WGI_RL.EST` is their vocabulary; `country.rule_of_law` is ours.
What shape the figure takes -- that it is an `Index` published on a -2.5 to 2.5 scale by "World
Bank WGI" -- is catalog data, read off the `Attribute`, so adding an attribute stays a pure data
change (`arch.md` 1.2).

**A WGI dimension is published as three series, not one**, and this adapter fetches all three.
The estimate is the figure; the source count and the standard error are the publisher's own
statement of how solid it is. They are not scored and never reach the arithmetic -- they are
written into the value's provenance, so a reader can see that Liechtenstein's rule-of-law
estimate rests on 4 underlying sources where Germany's rests on 13. Discarding that would be
presenting two unequally solid numbers as though they were equally solid, which is the exact
failure "data quality is the product" exists to prevent.
"""

from abc import ABC, abstractmethod
from types import MappingProxyType
from typing import Final

from starnest.data import AttributeId


class WorldBankIndicator(ABC):
    """One of our attributes, as the World Bank publishes it.

    **Three facts vary between their collections and nothing else does.** Which series carry the
    figure, which databank holds them, and what the publication is called -- the request shape,
    the envelope and the decoder are the same for all of it (`response.py`). So this is an
    abstraction over the World Bank's own filing, not over "a data source": a second publisher
    would be a second adapter, because how a publisher answers is its own business
    (`arch.md` 6.3).
    """

    @property
    @abstractmethod
    def estimate(self) -> str:
        """The series carrying the figure that is scored. Exactly one, always."""

    @property
    @abstractmethod
    def series(self) -> tuple[str, ...]:
        """Every series to request, the estimate among them, in request order."""

    @property
    @abstractmethod
    def databank(self) -> str:
        """Which collection holds it. The API answers a 200 carrying a refusal for the wrong one."""

    @property
    @abstractmethod
    def publication(self) -> str:
        """What to call it in a value's quote, so a reader knows which World Bank product it is."""


class GovernanceIndicator(WorldBankIndicator):
    """One WGI dimension, and the three series the World Bank publishes it as.

    Built from the two-letter dimension code because the suffixes are a naming convention rather
    than three independent facts: writing them out would be three chances to typo one.
    """

    __slots__ = ("dimension",)

    def __init__(self, dimension: str) -> None:
        self.dimension = dimension

    @property
    def estimate(self) -> str:
        """The governance estimate itself -- the only one of the three that is scored."""
        return f"GOV_WGI_{self.dimension}.EST"

    @property
    def source_count(self) -> str:
        """How many underlying sources the estimate aggregates."""
        return f"GOV_WGI_{self.dimension}.SR"

    @property
    def standard_error(self) -> str:
        """The World Bank's own uncertainty on the estimate."""
        return f"GOV_WGI_{self.dimension}.SE"

    @property
    def series(self) -> tuple[str, ...]:
        """All three, in the order the request asks for them."""
        return (self.estimate, self.source_count, self.standard_error)

    @property
    def databank(self) -> str:
        return WGI_DATABANK

    @property
    def publication(self) -> str:
        return "World Bank WGI"

    def __repr__(self) -> str:
        return f"GovernanceIndicator({self.dimension!r})"


class DevelopmentIndicator(WorldBankIndicator):
    """One World Development Indicators series -- a measurement, published on its own.

    **Nothing accompanies it, and that is the honest shape.** A WGI estimate ships with its
    source count and standard error because it is a model over surveys and the publisher says
    how solid each one is; forest area as a share of land area is a measurement, and inventing a
    second series to keep the code symmetrical would be pretending it carries an uncertainty the
    World Bank does not publish.
    """

    __slots__ = ("code",)

    def __init__(self, code: str) -> None:
        self.code = code

    @property
    def estimate(self) -> str:
        return self.code

    @property
    def series(self) -> tuple[str, ...]:
        return (self.code,)

    @property
    def databank(self) -> str:
        return WDI_DATABANK

    @property
    def publication(self) -> str:
        return "World Bank WDI"

    def __repr__(self) -> str:
        return f"DevelopmentIndicator({self.code!r})"


INDICATORS: Final = MappingProxyType(
    {
        AttributeId("country.rule_of_law"): GovernanceIndicator("RL"),
        AttributeId("country.control_of_corruption"): GovernanceIndicator("CC"),
        AttributeId("country.political_economic_stability"): GovernanceIndicator("PV"),
        # Forest area as a share of land area. **A measurement rather than an aggregate**, which
        # is why it needs no exception to section 3.5a's test: nobody has weighted anything to
        # produce it. It answers a `nature` attribute that was in no P4 stream at all, though it
        # has declared a source since the catalog was written (`devplan.md`, Gate B).
        AttributeId("country.forest_cover"): DevelopmentIndicator("AG.LND.FRST.ZS"),
    }
)
"""The attributes `reqs.md` 7.1 names the World Bank for.

Three rather than six: WGI also publishes government effectiveness, regulatory quality, and
voice and accountability, and the catalog has no attribute for any of them. An adapter offering
a series nothing asks for would be code written to be exported.

**Two of the three are `blocks_if_missing` in the shipped set** -- `rule_of_law` and
`political_economic_stability` -- which is why this stream comes first (`devplan.md` D7).
"""

BASE_URL: Final = "https://api.worldbank.org/v2"
"""Free, unauthenticated, no documented quota. No key reaches this file."""

WDI_DATABANK: Final = "2"
"""The World Development Indicators -- the API's default, named anyway.

Spelled out rather than left to the default because the request says which databank it wants for
WGI, and a reader comparing the two should not have to know that one of them is implicit.
"""

WGI_DATABANK: Final = "3"
"""The WGI lives in databank 3, and the request must say so.

Without `source=3` the API answers "The indicator was not found. It may have been deleted or
archived" -- a 200 carrying a refusal, for a series that exists. The default databank is the
World Development Indicators, and these are not in it.
"""

MOST_RECENT_NON_EMPTY: Final = "1"
"""`mrnev=1`: the newest year each country actually reported, decided per country by the server.

The Eurostat adapter does this arithmetic itself, and deliberately fetches whole series to avoid
trimming away late-publishing countries. The reasoning does not transfer. There, the parameter
on offer (`lastTimePeriod`) trims to the last *n* periods of the dataset and drops anyone who
had not filed; here the server returns each country's own newest figure and says in `date` which
year that was. Same honesty, a third of the payload.
"""
