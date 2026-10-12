"""OpenFlights as a `SourceAdapter`: one figure per country, computed from a vendored route graph.

OpenFlights is the rank-2 source the catalog already declares for
`country.international_air_connectivity` (`0101`), and it answers the question exactly -- but its
route feed is frozen in 2017, so the design had left it unwired and let the LLM fallback answer
instead (`reqs.md` 2391). Wiring it fills the countries the fallback never reached: a stale figure
ranks below any fresher one for the same attribute, so it supersedes nothing, and where nothing
else answers it is a real count rather than a blank.

**Free, offline, deterministic.** The two `.dat` files are vendored (`data/`, with their
provenance and licence), so nothing is fetched at run time and the computation is a pure function
of files in the repo. `costs_money` stays False.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime
from functools import cached_property
from pathlib import Path
from typing import Final

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    Count,
    DataSourceId,
    Measurements,
    ReferencePeriod,
    Value,
    ValueType,
)
from starnest.data_acquisition import Acquired, SourceAdapter
from starnest.data_sources.openflights.connectivity import counts_for
from starnest.data_sources.transport import a_failure

OPENFLIGHTS: Final = DataSourceId("openflights")

AIR_CONNECTIVITY: Final = AttributeId("country.international_air_connectivity")

_DATA_DIR: Final = Path(__file__).parent / "data"

# The route feed's last meaningful revision (`data/PROVENANCE.md`). Every figure describes the
# network as it stood then, which is what makes it land stale against a 24-month max_age -- stated
# as the reference period rather than disguised with today's date.
SNAPSHOT: Final = date(2017, 2, 2)

_PROVENANCE: Final = (
    "distinct foreign destination airports reachable by a direct scheduled route, counted from "
    "the OpenFlights route graph (frozen 2017 snapshot)"
)


class OpenFlightsAdapter(SourceAdapter):
    """`country.international_air_connectivity`, counted from the vendored OpenFlights tables."""

    def __init__(self, data_dir: Path = _DATA_DIR) -> None:
        self._data_dir = data_dir

    @property
    def data_source(self) -> DataSourceId:
        return OPENFLIGHTS

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (AIR_CONNECTIVITY,)

    @cached_property
    def _routes(self) -> str:
        return (self._data_dir / "routes.dat").read_text(encoding="utf-8")

    @cached_property
    def _airports(self) -> str:
        return (self._data_dir / "airports.dat").read_text(encoding="utf-8")

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if attribute.id != AIR_CONNECTIVITY:
            reason = "the OpenFlights adapter answers no such attribute"
            return Acquired(failures=(a_failure(attribute.id, reason),))
        if attribute.value_type is not ValueType.COUNT:
            # A broken catalog, not a failed fetch: raised once rather than recorded per country as
            # OpenFlights' fault (the argument the Copernicus adapter makes for its own type guard).
            raise ValueError(f"{attribute.id} must be a Count for the OpenFlights adapter")

        wanted = {
            candidate.country_code: candidate for candidate in candidates if candidate.country_code
        }
        counts = counts_for(wanted, self._routes, self._airports)

        measuring = Measurements(
            attribute=attribute,
            data_source=OPENFLIGHTS,
            retrieved=datetime.now(UTC),
            confidence_level=ConfidenceLevel.LOW,
        )
        values: list[Value] = [
            measuring.figure(
                candidate=wanted[iso],
                payload=Count(count=count, basis="per_country"),
                period=ReferencePeriod(start=SNAPSHOT, end=SNAPSHOT),
                quote=f"{count} {_PROVENANCE}",
            )
            for iso, count in counts.items()
        ]
        # A roster country with no airport in the data (Liechtenstein) simply gets no value: a
        # coverage gap, not a zero, the same rule every structured adapter here follows.
        return Acquired(values=tuple(values))
