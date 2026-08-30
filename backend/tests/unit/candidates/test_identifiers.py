"""The identifier convention, and the promise that a display name never reaches one.

Identifiers are permanent and names are not (`arch.md` 3.2a), so the tests that matter here
are the ones that pin the shape of an identifier and refuse everything else. A silently
accepted `Country.Portugal` would sit in the database for the life of the project.
"""

import pytest
from pydantic import BaseModel, ValidationError

from starnest.candidates import CandidateId, LevelId, MalformedIdentifierError
from starnest.candidates import suggest_identifier_segment as suggest

PORTUGAL = "country.portugal"
LISBON = "city.portugal.lisbon"
# A third level. Nothing in this module may assume there are exactly two (reqs.md 3.1).
ALFAMA = "neighbourhood.portugal.lisbon.alfama"


class TestLevelId:
    @pytest.mark.parametrize("text", ["country", "city", "neighbourhood", "sub_region", "zone2"])
    def test_accepts_one_lowercase_segment(self, text: str) -> None:
        assert LevelId(text) == text

    @pytest.mark.parametrize(
        "text",
        [
            "",
            " ",
            "Country",
            "COUNTRY",
            "co untry",
            "country-region",
            "1country",
            "_country",
            "country.",
            "country.city",
        ],
        ids=[
            "empty",
            "blank",
            "capitalised",
            "shouting",
            "a space",
            "a hyphen",
            "leading digit",
            "leading underscore",
            "trailing separator",
            "two segments",
        ],
    )
    def test_refuses_anything_else(self, text: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            LevelId(text)


class TestParsingACandidateId:
    @pytest.mark.parametrize(
        ("text", "level", "path", "own"),
        [
            (PORTUGAL, "country", ("portugal",), "portugal"),
            (LISBON, "city", ("portugal", "lisbon"), "lisbon"),
            (ALFAMA, "neighbourhood", ("portugal", "lisbon", "alfama"), "alfama"),
        ],
    )
    def test_splits_into_a_level_and_a_qualifying_path(
        self, text: str, level: str, path: tuple[str, ...], own: str
    ) -> None:
        identifier = CandidateId(text)

        assert identifier.level_id == level
        assert identifier.qualifying_path == path
        assert identifier.own_segment == own

    @pytest.mark.parametrize(
        "text",
        ["", "portugal", "city..lisbon", ".portugal", "city.Portugal.lisbon", "city.lisbon "],
        ids=[
            "empty",
            "no level",
            "empty segment",
            "no level name",
            "capitalised",
            "trailing space",
        ],
    )
    def test_refuses_anything_that_is_not_level_dot_path(self, text: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            CandidateId(text)


class TestBuildingACandidateId:
    def test_a_top_level_place_is_its_level_and_one_segment(self) -> None:
        assert CandidateId.build(level="country", own_segment="portugal") == PORTUGAL

    def test_a_nested_place_repeats_the_path_of_its_parent(self) -> None:
        built = CandidateId.build(level="city", own_segment="lisbon", parent=CandidateId(PORTUGAL))

        assert built == LISBON

    def test_the_rule_does_not_stop_at_two_levels(self) -> None:
        """The proof that `country.city` is a seed list, not an assumption in the code."""
        built = CandidateId.build(
            level="neighbourhood", own_segment="alfama", parent=CandidateId(LISBON)
        )

        assert built == ALFAMA

    @pytest.mark.parametrize("own_segment", ["", "Lisbon", "lisbon city", "lisboa."])
    def test_refuses_a_segment_that_is_not_in_the_alphabet(self, own_segment: str) -> None:
        with pytest.raises(MalformedIdentifierError):
            CandidateId.build(level="city", own_segment=own_segment, parent=CandidateId(PORTUGAL))

    def test_refuses_a_level_that_is_not_one_segment(self) -> None:
        with pytest.raises(MalformedIdentifierError):
            CandidateId.build(level="city.portugal", own_segment="lisbon")


class TestNamingTheContainer:
    @pytest.mark.parametrize(
        ("text", "parent_level", "expected"),
        [(LISBON, "country", PORTUGAL), (ALFAMA, "city", LISBON)],
    )
    def test_drops_the_last_segment_and_re_levels_the_rest(
        self, text: str, parent_level: str, expected: str
    ) -> None:
        assert CandidateId(text).parent_id(parent_level) == expected

    def test_a_top_level_identifier_names_no_container(self) -> None:
        with pytest.raises(MalformedIdentifierError):
            CandidateId(PORTUGAL).parent_id("country")


class TestBehavingAsTheStringItIs:
    def test_compares_and_hashes_as_a_plain_string(self) -> None:
        identifier = CandidateId(PORTUGAL)

        assert identifier == PORTUGAL
        assert {identifier: "seen"}[PORTUGAL] == "seen"

    def test_a_model_field_accepts_a_plain_string_and_validates_it(self) -> None:
        class Row(BaseModel):
            candidate: CandidateId

        assert isinstance(Row(candidate=PORTUGAL).candidate, CandidateId)
        assert Row(candidate=PORTUGAL).model_dump() == {"candidate": PORTUGAL}
        with pytest.raises(ValidationError):
            Row(candidate="Portugal")


class TestSuggestingASegment:
    @pytest.mark.parametrize(
        ("display_name", "expected"),
        [
            ("Portugal", "portugal"),
            ("United Kingdom", "united_kingdom"),
            ("Bosnia-Herzegovina", "bosnia_herzegovina"),
            ("  Spain  ", "spain"),
        ],
    )
    def test_lowercases_and_replaces_the_gaps(self, display_name: str, expected: str) -> None:
        assert suggest(display_name) == expected

    @pytest.mark.parametrize(
        "display_name",
        ["Türkiye", "Côte d'Azur", "", "   ", "3 Rivers"],
        ids=["diacritic", "apostrophe", "empty", "blank", "leading digit"],
    )
    def test_refuses_rather_than_transliterating_silently(self, display_name: str) -> None:
        """There is more than one defensible answer for "Türkiye", so a person picks it."""
        with pytest.raises(MalformedIdentifierError):
            suggest(display_name)
