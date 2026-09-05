"""A candidate, and the rule about what may contain what.

The nesting rule is enforced rather than assumed because candidates arrive from seed
migrations, where a city recorded as the parent of another city is easy to write and
impossible to notice (`reqs.md` 3.1).

Construction goes through Pydantic, so a domain error surfaces as `ValidationError` -- which
is itself a `ValueError`, and carries the original exception in its context. The tests
therefore assert on `ValidationError` and on the message, and one test pins the recovery of
the underlying `NestingError` for callers that want to branch on it.
"""

import re

import pytest
from pydantic import ValidationError

from starnest.candidates import Candidate, CandidateId, Level, NestingError

COUNTRY = Level(id="country", depth_order=1)
CITY = Level(id="city", depth_order=2, parent_level="country")
NEIGHBOURHOOD = Level(id="neighbourhood", depth_order=3, parent_level="city")

PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY)
LISBON = Candidate(
    id="city.portugal.lisbon", name="Lisbon", level=CITY, parent_candidate="country.portugal"
)


def a_city(identifier: str, parent: str, name: str = "Somewhere") -> Candidate:
    return Candidate(id=identifier, name=name, level=CITY, parent_candidate=parent)


class TestWhatACandidateIs:
    def test_a_top_level_candidate_is_contained_by_nothing(self) -> None:
        assert PORTUGAL.is_top_level
        assert PORTUGAL.parent_candidate is None
        assert PORTUGAL.parent_level is None

    def test_a_nested_candidate_takes_its_parent_level_from_its_level(self) -> None:
        assert not LISBON.is_top_level
        assert LISBON.parent_level == "country"
        assert LISBON.parent_candidate == "country.portugal"

    def test_knows_what_sits_directly_inside_it(self) -> None:
        assert PORTUGAL.contains(LISBON)
        assert not LISBON.contains(PORTUGAL)
        assert not PORTUGAL.contains(PORTUGAL)

    def test_a_village_is_as_valid_a_candidate_as_a_capital(self) -> None:
        """A "city" is any locality regardless of size (`reqs.md` 3.1)."""
        aljezur = a_city("city.portugal.aljezur", "country.portugal", name="Aljezur")

        assert PORTUGAL.contains(aljezur)

    def test_carries_nothing_an_evaluation_owns(self) -> None:
        """No score, no status, no `parent_not_matching` -- all of them depend on which
        criteria set was used, so they belong to the result, not the place.

        `country_code` passes this bar and a score does not, which is the distinction the test
        is really about: ISO 3166-1 alpha-2 is true of Portugal whoever is looking and whatever
        they weighted, so it is a property of the place in the way a score never is.
        """
        assert set(Candidate.model_fields) == {
            "id",
            "name",
            "level",
            "parent_candidate",
            "country_code",
        }

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            Candidate(
                id="country.portugal",
                name="Portugal",
                level=COUNTRY,
                parent_not_matching=True,
            )


class TestTheNameIsNotTheIdentifier:
    def test_a_rename_changes_the_name_and_never_the_identifier(self) -> None:
        """Czechia, Türkiye, Eswatini. Every reference has to survive (`arch.md` 3.2a)."""
        czechia = Candidate(id="country.czech_republic", name="Czech Republic", level=COUNTRY)

        renamed = czechia.renamed_to("Czechia")

        assert renamed.id == "country.czech_republic"
        assert renamed.name == "Czechia"
        assert czechia.name == "Czech Republic"

    def test_a_rename_still_needs_a_label(self) -> None:
        with pytest.raises(ValidationError):
            PORTUGAL.renamed_to("   ")

    def test_the_identifier_cannot_be_assigned(self) -> None:
        with pytest.raises(ValidationError):
            PORTUGAL.id = CandidateId("country.spain")

    def test_a_name_is_trimmed_rather_than_stored_with_its_padding(self) -> None:
        assert Candidate(id="country.spain", name="  Spain  ", level=COUNTRY).name == "Spain"

    @pytest.mark.parametrize("name", ["", "   ", "\t\n"])
    def test_refuses_a_blank_name(self, name: str) -> None:
        with pytest.raises(ValidationError, match="display name"):
            Candidate(id="country.spain", name=name, level=COUNTRY)


class TestPlacementsTheHierarchyForbids:
    def test_a_city_must_name_the_country_that_contains_it(self) -> None:
        with pytest.raises(ValidationError, match="must name a parent"):
            Candidate(id="city.portugal.lisbon", name="Lisbon", level=CITY)

    def test_a_city_parented_to_a_city_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="level 'country'"):
            a_city("city.portugal.lisbon", "city.portugal.porto", name="Lisbon")

    def test_a_country_cannot_be_contained_by_anything(self) -> None:
        with pytest.raises(ValidationError, match="widest level"):
            Candidate(
                id="country.portugal",
                name="Portugal",
                level=COUNTRY,
                parent_candidate="country.spain",
            )

    def test_an_identifier_from_another_level_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="recorded at level 'city'"):
            Candidate(
                id="country.portugal", name="Lisbon", level=CITY, parent_candidate="country.spain"
            )

    def test_a_city_identifier_must_repeat_its_country(self) -> None:
        """City names are not globally unique, which is the whole reason for the scheme."""
        with pytest.raises(ValidationError, match=re.escape("city.portugal.lisbon")):
            a_city("city.lisbon", "country.portugal", name="Lisbon")

    def test_a_city_identifier_qualified_by_the_wrong_country_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="does not repeat the path"):
            a_city("city.spain.lisbon", "country.portugal", name="Lisbon")

    def test_a_top_level_identifier_carries_no_qualifying_path(self) -> None:
        with pytest.raises(ValidationError, match="contained by nothing"):
            Candidate(id="country.portugal.lisbon", name="Portugal", level=COUNTRY)

    @pytest.mark.parametrize("identifier", ["", "portugal", "Country.Portugal", "country."])
    def test_a_malformed_identifier_never_becomes_a_candidate(self, identifier: str) -> None:
        with pytest.raises(ValidationError):
            Candidate(id=identifier, name="Portugal", level=COUNTRY)

    def test_the_underlying_error_is_recoverable(self) -> None:
        with pytest.raises(ValidationError) as refusal:
            a_city("city.portugal.lisbon", "city.portugal.porto")

        assert isinstance(refusal.value.errors()[0]["ctx"]["error"], NestingError)


class TestNothingAssumesThereAreExactlyTwoLevels:
    """A third level exercises the same machinery. It is not in scope; the point is that
    adding one would be a row, not a rewrite (`reqs.md` 3.1)."""

    def test_a_third_level_nests_under_the_second(self) -> None:
        alfama = Candidate(
            id="neighbourhood.portugal.lisbon.alfama",
            name="Alfama",
            level=NEIGHBOURHOOD,
            parent_candidate="city.portugal.lisbon",
        )

        assert LISBON.contains(alfama)
        assert alfama.parent_level == "city"
        assert not alfama.is_top_level

    def test_a_third_level_parented_to_the_first_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="level 'city'"):
            Candidate(
                id="neighbourhood.portugal.alfama",
                name="Alfama",
                level=NEIGHBOURHOOD,
                parent_candidate="country.portugal",
            )


class TestTheCountryCode:
    def test_a_country_carries_its_iso_code(self) -> None:
        """Alpha-2, because every structured source keys countries by it and the translation
        has to live somewhere that is not the second adapter to need it."""
        portugal = Candidate(
            id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT"
        )

        assert portugal.country_code == "PT"

    def test_a_country_nobody_has_coded_yet_is_allowed(self) -> None:
        """The column was added before the codes were seeded, and a city never has one."""
        assert Candidate(id="country.portugal", name="Portugal", level=COUNTRY).country_code is None

    @pytest.mark.parametrize(
        "wrong",
        ["PRT", "P", "pt", "P1", ""],
        ids=["alpha-3", "one letter", "lowercase", "digit", "empty"],
    )
    def test_something_that_is_not_an_alpha_2_code_is_refused(self, wrong: str) -> None:
        """The mistake worth refusing is an alpha-3 code, or a source's own spelling, in a
        column whose readers will treat it as the standard."""
        with pytest.raises(ValidationError):
            Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code=wrong)

    def test_a_rename_keeps_the_code(self) -> None:
        """Czechia is the case this exists for: the label changed and CZ did not."""
        czechia = Candidate(
            id="country.czechia", name="Czech Republic", level=COUNTRY, country_code="CZ"
        )

        assert czechia.renamed_to("Czechia").country_code == "CZ"
