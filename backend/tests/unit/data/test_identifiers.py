"""What the objective half of the model calls things.

The convention itself is `candidates/`'s and is tested there. What is tested here is that
these identifiers hold to it, and that each one refuses the shapes that would let two
different things share a key.
"""

import pytest

from starnest.candidates import MalformedIdentifierError
from starnest.data import (
    AttributeId,
    BreakdownOptionId,
    BreakdownSchemeId,
    CurrencyCode,
    DataSourceId,
    PillarId,
    ReliabilityTierId,
    UnitId,
)

SINGLE_SEGMENT_TYPES = [
    PillarId,
    DataSourceId,
    BreakdownSchemeId,
    BreakdownOptionId,
    UnitId,
    ReliabilityTierId,
]


class TestCatalogIdentifiers:
    @pytest.mark.parametrize("identifier_type", SINGLE_SEGMENT_TYPES)
    def test_accepts_the_identifier_alphabet(self, identifier_type: type) -> None:
        assert identifier_type("official_international2") == "official_international2"

    @pytest.mark.parametrize("identifier_type", SINGLE_SEGMENT_TYPES)
    @pytest.mark.parametrize("malformed", ["Numbeo", "two words", "", "a.b", "2numbeo", "n-b"])
    def test_refuses_anything_outside_it(self, identifier_type: type, malformed: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            identifier_type(malformed)

    @pytest.mark.parametrize("identifier_type", SINGLE_SEGMENT_TYPES)
    def test_is_the_string_it_looks_like(self, identifier_type: type) -> None:
        """So no consumer has to unwrap it on the way to SQL, a URL or a dictionary key."""
        assert {identifier_type("numbeo"): 1}["numbeo"] == 1


class TestAttributeIdentifiers:
    def test_is_the_level_and_the_name(self) -> None:
        attribute = AttributeId("country.rent_centre")
        assert attribute.level_id == "country"
        assert attribute.own_segment == "rent_centre"

    def test_is_composed_from_its_two_halves(self) -> None:
        assert AttributeId.build(level="city", name="rent_centre") == "city.rent_centre"

    def test_the_same_concept_at_two_levels_is_two_identifiers(self) -> None:
        """`reqs.md` 3.3: they are different questions, not one question at two zoom levels."""
        assert AttributeId("country.tech_software_jobs") != AttributeId("city.tech_software_jobs")

    @pytest.mark.parametrize(
        "malformed", ["rent_centre", "country.rent.centre", "", "Country.rent"]
    )
    def test_refuses_anything_that_is_not_exactly_level_and_name(self, malformed: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            AttributeId(malformed)

    def test_says_how_many_segments_it_found(self) -> None:
        with pytest.raises(MalformedIdentifierError) as raised:
            AttributeId("country.rent.centre")
        assert "3 segment" in str(raised.value)


class TestCurrencyCodes:
    @pytest.mark.parametrize("code", ["EUR", "CHF", "HUF"])
    def test_accepts_iso_4217(self, code: str) -> None:
        assert CurrencyCode(code) == code

    @pytest.mark.parametrize("malformed", ["eur", "EURO", "EU", "", "E1R".lower()])
    def test_refuses_anything_else(self, malformed: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            CurrencyCode(malformed)
