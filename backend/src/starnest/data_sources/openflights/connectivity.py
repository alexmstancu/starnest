"""International air connectivity, computed from OpenFlights' route graph.

`country.international_air_connectivity` is "international destinations served, worldwide"
(`reqs.md` 2384): the count of distinct *foreign* destination airports a country's airports
reach by a direct scheduled route. OpenFlights publishes the two tables that answer it exactly --
`airports.dat` (every airport, with the country it sits in) and `routes.dat` (every direct
route, as a source and destination airport). A country's figure is the number of distinct
destination airports, in a different country, reachable without a stop from any of its airports.

**The data is a frozen 2017 snapshot and that is stated, not hidden.** OpenFlights' route feed
stopped updating in 2014-2017 (`data/PROVENANCE.md`), so every figure describes early 2017 and
lands honestly stale -- the active-value rule ranks it below any fresher source for the same
attribute (`0011-active-value-view.sql`), which is exactly the standing a nine-year-old figure
should have. It is `low` confidence for the same reason, and because the routes are crowdsourced.

The computation is pure and deterministic over the vendored files, so it is a plain test rather
than a captured fixture: `international_destinations` must return Germany 314 and the Netherlands
253, the two figures `reqs.md` 2391 recorded when OpenFlights was assessed.
"""

import csv
from collections import defaultdict
from collections.abc import Iterable
from typing import Final

_NO_STOPS: Final = "0"
"""`routes.dat` marks a direct flight with zero stops; a one-stop itinerary is not a destination
the origin country "serves" and is excluded."""

NAME_TO_ISO: Final = {
    "Austria": "AT",
    "Belgium": "BE",
    "Bulgaria": "BG",
    "Croatia": "HR",
    "Cyprus": "CY",
    "Czech Republic": "CZ",
    "Denmark": "DK",
    "Estonia": "EE",
    "Finland": "FI",
    "France": "FR",
    "Germany": "DE",
    "Greece": "GR",
    "Hungary": "HU",
    "Iceland": "IS",
    "Ireland": "IE",
    "Italy": "IT",
    "Latvia": "LV",
    "Liechtenstein": "LI",
    "Lithuania": "LT",
    "Luxembourg": "LU",
    "Malta": "MT",
    "Netherlands": "NL",
    "Norway": "NO",
    "Poland": "PL",
    "Portugal": "PT",
    "Romania": "RO",
    "Slovakia": "SK",
    "Slovenia": "SI",
    "Spain": "ES",
    "Sweden": "SE",
    "Switzerland": "CH",
    "United Kingdom": "GB",
}
"""OpenFlights' country spelling -> the ISO alpha-2 our candidates carry, for the roster only.
The same kind of source-format bridge as Copernicus's `NUTS_TO_ISO`: OpenFlights writes
`Czech Republic` where our catalog is `CZ`/Czechia, and a country only needs an entry here to be
matched as a route *origin*. Foreignness is judged by the airport's country name directly, so a
destination in any country at all still counts."""


def _airport_country(airports_dat: str) -> dict[str, str]:
    """Each airport's IATA code mapped to the country it sits in.

    `airports.dat` is `id,name,city,country,IATA,ICAO,...`; a `\\N` IATA (airports with only an
    ICAO code) is skipped, because a route names airports by IATA.
    """
    by_iata: dict[str, str] = {}
    for row in csv.reader(airports_dat.splitlines()):
        if len(row) < 5:
            continue
        country, iata = row[3].strip(), row[4].strip()
        if iata and iata != "\\N":
            by_iata[iata] = country
    return by_iata


def international_destinations(routes_dat: str, airports_dat: str) -> dict[str, int]:
    """Distinct foreign destination airports reachable by a direct route, per roster country.

    Keyed by ISO alpha-2, and only for roster countries that originate at least one route --
    Liechtenstein has no airport in the data and so gets no entry, which is coverage (a real gap),
    not a zero. A route is counted when its origin is a roster country and its destination airport
    sits in a *different* country, so domestic hops do not inflate the figure.
    """
    by_iata = _airport_country(airports_dat)
    foreign_destinations: dict[str, set[str]] = defaultdict(set)
    for row in csv.reader(routes_dat.splitlines()):
        if len(row) < 8 or row[7].strip() != _NO_STOPS:
            continue
        source_iata, destination_iata = row[2].strip(), row[4].strip()
        source_country = by_iata.get(source_iata)
        destination_country = by_iata.get(destination_iata)
        if source_country is None or destination_country is None:
            continue
        iso = NAME_TO_ISO.get(source_country)
        if iso is not None and destination_country != source_country:
            foreign_destinations[iso].add(destination_iata)
    return {iso: len(destinations) for iso, destinations in foreign_destinations.items()}


def counts_for(isos: Iterable[str], routes_dat: str, airports_dat: str) -> dict[str, int]:
    """The figure for the given ISO codes only, dropping any the route graph does not answer."""
    everywhere = international_destinations(routes_dat, airports_dat)
    return {iso: everywhere[iso] for iso in isos if iso in everywhere}
