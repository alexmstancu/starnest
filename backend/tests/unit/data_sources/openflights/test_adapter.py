"""The adapter turning the vendored route graph into stored values.

Driven against the real vendored files (the computation is offline and deterministic, so there is
nothing to stub): the adapter must return a `Count` per answered country, stamped 2017 and `low`
confidence, and must leave a country the graph does not cover absent rather than zeroed.
"""

from datetime import date

import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, Count, ValueType
from starnest.data_sources.openflights import OPENFLIGHTS, OpenFlightsAdapter
from starnest.data_sources.openflights.adapter import AIR_CONNECTIVITY

COUNTRY = {"id": "country", "depth_order": 1}


def a_country(name: str, alpha2: str | None) -> Candidate:
    return Candidate(
        id=f"country.{name}",
        name=name.title(),
        level=COUNTRY,
        country_code=alpha2,
        country_code_alpha3=None,
    )


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": AIR_CONNECTIVITY,
        "name": "International air connectivity",
        "level": "country",
        "value_type": ValueType.COUNT,
        "pillar": "connectivity",
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


ROSTER = [
    a_country("germany", "DE"),
    a_country("netherlands", "NL"),
    a_country("liechtenstein", "LI"),  # no airport in the data
]


class TestTheAdapter:
    async def test_it_counts_foreign_destinations_for_each_country(self) -> None:
        acquired = await OpenFlightsAdapter().fetch(an_attribute(), ROSTER)

        by_country = {value.candidate: value for value in acquired.values}
        assert by_country["country.germany"].payload == Count(count=314, basis="per_country")
        assert by_country["country.netherlands"].payload == Count(count=253, basis="per_country")

    async def test_a_country_with_no_airport_is_left_absent(self) -> None:
        acquired = await OpenFlightsAdapter().fetch(an_attribute(), ROSTER)

        assert "country.liechtenstein" not in {value.candidate for value in acquired.values}
        assert not acquired.failures

    async def test_every_value_is_stamped_2017_and_low_confidence(self) -> None:
        acquired = await OpenFlightsAdapter().fetch(an_attribute(), ROSTER)

        assert acquired.values, "expected at least one value"
        for value in acquired.values:
            assert value.data_source == OPENFLIGHTS
            assert value.confidence_level is ConfidenceLevel.LOW
            assert value.reference_period.start == date(2017, 2, 2)
            assert value.reference_period.end == date(2017, 2, 2)

    async def test_a_candidate_with_no_country_code_is_skipped(self) -> None:
        acquired = await OpenFlightsAdapter().fetch(an_attribute(), [a_country("nowhere", None)])

        assert not acquired.values and not acquired.failures

    async def test_an_attribute_it_does_not_answer_is_a_failure(self) -> None:
        other = an_attribute(id="country.broadband_coverage")
        acquired = await OpenFlightsAdapter().fetch(other, ROSTER)

        assert not acquired.values
        assert acquired.failures and acquired.failures[0].attribute == "country.broadband_coverage"

    async def test_a_non_count_catalog_entry_raises(self) -> None:
        """A broken catalog is raised once, not recorded 31 times as OpenFlights' fault."""
        with pytest.raises(ValueError, match="must be a Count"):
            await OpenFlightsAdapter().fetch(an_attribute(value_type=ValueType.RATIO), ROSTER)

    def test_it_declares_exactly_the_one_attribute_the_catalog_gives_it(self) -> None:
        adapter = OpenFlightsAdapter()

        assert adapter.attributes == (AIR_CONNECTIVITY,)
        assert adapter.data_source == OPENFLIGHTS
        assert adapter.costs_money is False
