"""The route-graph computation: foreign destinations counted, domestic and one-stop excluded.

A synthetic graph pins the rules exactly, and the vendored files pin the two figures `reqs.md`
2391 recorded -- Germany 314 and the Netherlands 253 -- so a change to the data or the counting
that moved them would fail here rather than quietly re-rank the connectivity pillar.
"""

from starnest.data_sources.openflights.adapter import _DATA_DIR
from starnest.data_sources.openflights.connectivity import (
    counts_for,
    international_destinations,
)


def _airport(iata: str, country: str) -> str:
    return f'1,"{iata} Airport","City","{country}","{iata}","X",0,0,0,0,"E","Z","airport","src"'


AIRPORTS = "\n".join(
    [
        _airport("FRA", "Germany"),
        _airport("MUC", "Germany"),
        _airport("AMS", "Netherlands"),
        _airport("JFK", "United States"),
        _airport("CDG", "France"),
    ]
)


def _route(source: str, destination: str, stops: str = "0") -> str:
    return f"XX,1,{source},100,{destination},200,,{stops},EQ"


class TestTheCountingRules:
    def test_a_foreign_destination_counts_and_a_domestic_one_does_not(self) -> None:
        routes = "\n".join(
            [
                _route("FRA", "AMS"),  # Germany -> Netherlands, foreign
                _route("FRA", "JFK"),  # Germany -> United States, foreign
                _route("FRA", "MUC"),  # Germany -> Germany, domestic: not a destination served
            ]
        )

        assert international_destinations(routes, AIRPORTS)["DE"] == 2

    def test_a_one_stop_itinerary_is_not_a_direct_destination(self) -> None:
        routes = "\n".join([_route("FRA", "AMS"), _route("FRA", "JFK", stops="1")])

        assert international_destinations(routes, AIRPORTS)["DE"] == 1

    def test_the_same_foreign_airport_on_two_airlines_counts_once(self) -> None:
        routes = "\n".join([_route("FRA", "AMS"), _route("FRA", "AMS")])

        assert international_destinations(routes, AIRPORTS)["DE"] == 1

    def test_each_origin_country_is_counted_on_its_own(self) -> None:
        routes = "\n".join([_route("FRA", "AMS"), _route("AMS", "FRA")])
        everywhere = international_destinations(routes, AIRPORTS)

        assert everywhere["DE"] == 1 and everywhere["NL"] == 1

    def test_a_country_with_no_route_gets_no_entry(self) -> None:
        """Absence, not a zero: a country the graph does not answer is a coverage gap."""
        everywhere = international_destinations(_route("FRA", "AMS"), AIRPORTS)

        assert "FR" not in everywhere

    def test_counts_for_keeps_only_the_isos_asked(self) -> None:
        routes = "\n".join([_route("FRA", "AMS"), _route("AMS", "FRA")])

        assert counts_for(["DE"], routes, AIRPORTS) == {"DE": 1}


class TestTheVendoredGraph:
    """The frozen 2017 files must still produce the figures the design recorded."""

    def test_germany_and_the_netherlands_match_the_recorded_figures(self) -> None:
        routes = (_DATA_DIR / "routes.dat").read_text(encoding="utf-8")
        airports = (_DATA_DIR / "airports.dat").read_text(encoding="utf-8")

        everywhere = international_destinations(routes, airports)

        assert everywhere["DE"] == 314
        assert everywhere["NL"] == 253

    def test_liechtenstein_has_no_airport_and_so_no_figure(self) -> None:
        routes = (_DATA_DIR / "routes.dat").read_text(encoding="utf-8")
        airports = (_DATA_DIR / "airports.dat").read_text(encoding="utf-8")

        assert "LI" not in international_destinations(routes, airports)
