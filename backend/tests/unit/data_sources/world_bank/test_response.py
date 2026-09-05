"""The v2 envelope, including the shapes that look like success and are not.

The one worth reading is `a refusal arrives as 200 OK`. An unknown indicator code does not
produce an HTTP error -- it produces a perfectly ordinary response whose body happens to be one
element long and carry a `message`. Code that indexed into `document[1]` would raise
`IndexError` somewhere unhelpful, and code that used `.get` would quietly find nothing and
report an empty fetch.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from starnest.data_sources.world_bank import Reading, WorldBankError, readings

CAPTURED = Path(__file__).parent / "captured"


def captured(name: str) -> object:
    return json.loads((CAPTURED / f"{name}.json").read_text())


class TestWhatTheResponseCarries:
    def test_every_row_with_a_figure_becomes_a_reading(self) -> None:
        found = readings(captured("rule_of_law"))

        assert len(found) == 96  # 32 countries, three series each
        assert sum(1 for r in found if r.series.endswith(".EST")) == 32

    def test_a_reading_keeps_the_figure_the_world_bank_published(self) -> None:
        """Through `str`, so the float's binary noise never reaches the database."""
        romania = _one(readings(captured("rule_of_law")), "RO", "GOV_WGI_RL.EST")

        assert romania.figure == Decimal("0.3710995")
        assert str(romania.figure) == "0.3710995"
        assert romania.period == "2024"

    def test_the_country_is_the_alpha_2_code_the_candidates_already_use(self) -> None:
        """No translation layer, unlike Eurostat's EL for Greece and UK for the kingdom."""
        countries = {r.country for r in readings(captured("rule_of_law"))}

        assert "GR" in countries
        assert "GB" in countries
        assert "EL" not in countries


class TestWhatIsNotAFigure:
    def test_a_null_value_is_dropped_rather_than_read_as_a_figure(self) -> None:
        """A null is the World Bank saying it has nothing, and a nothing is not a zero."""
        found = readings([{"pages": 1}, [_row("RO", None), _row("PT", 1.5)]])

        assert [r.country for r in found] == ["PT"]

    def test_no_matching_rows_is_an_ordinary_empty_answer(self) -> None:
        """`null` rows is how the API says "nothing matched", not that anything went wrong."""
        assert readings([{"pages": 1}, None]) == ()


class TestTheShapesThatAreNotAnAnswer:
    def test_a_refusal_arrives_as_200_ok_and_is_still_a_refusal(self) -> None:
        refusal = [
            {
                "message": [
                    {"id": "175", "key": "Invalid format", "value": "The indicator was not found."}
                ]
            }
        ]

        with pytest.raises(WorldBankError, match="The indicator was not found"):
            readings(refusal)

    def test_a_refusal_with_nothing_readable_in_it_still_says_it_was_refused(self) -> None:
        with pytest.raises(WorldBankError, match="no reason given"):
            readings([{"message": "unreadable"}])

    def test_a_refusal_whose_messages_carry_no_value_says_so(self) -> None:
        with pytest.raises(WorldBankError, match="no reason given"):
            readings([{"message": ["not an object"]}])

    def test_a_split_answer_is_an_error_rather_than_its_first_page(self) -> None:
        """Returning page one would drop countries while looking like a successful fetch."""
        with pytest.raises(WorldBankError, match="split this answer across 4 pages"):
            readings([{"pages": 4}, [_row("RO", 1.0)]])

    @pytest.mark.parametrize(
        "document",
        [
            pytest.param({"not": "a list"}, id="an object"),
            pytest.param([], id="an empty list"),
            pytest.param("[]", id="a string"),
        ],
    )
    def test_something_other_than_the_usual_array_is_refused(self, document: object) -> None:
        with pytest.raises(WorldBankError, match="other than its usual array"):
            readings(document)

    def test_metadata_without_rows_is_refused(self) -> None:
        with pytest.raises(WorldBankError, match="without the metadata and rows"):
            readings([{"pages": 1}])

    def test_rows_that_are_not_a_list_are_refused(self) -> None:
        with pytest.raises(WorldBankError, match="rows that are not a list"):
            readings([{"pages": 1}, {"row": 1}])

    def test_a_row_that_is_not_an_object_is_refused(self) -> None:
        with pytest.raises(WorldBankError, match="a row that is not an object"):
            readings([{"pages": 1}, ["a string"]])

    @pytest.mark.parametrize("field", ["indicator", "country"])
    def test_a_row_naming_no_series_or_country_is_refused(self, field: str) -> None:
        row = _row("RO", 1.0)
        del row[field]

        with pytest.raises(WorldBankError, match=f"names no {field}"):
            readings([{"pages": 1}, [row]])

    def test_a_row_whose_name_is_not_the_usual_pair_is_refused(self) -> None:
        row = _row("RO", 1.0) | {"country": {"value": "Romania"}}

        with pytest.raises(WorldBankError, match="names no country"):
            readings([{"pages": 1}, [row]])

    def test_a_row_with_no_date_is_refused(self) -> None:
        row = _row("RO", 1.0) | {"date": ""}

        with pytest.raises(WorldBankError, match="names no date"):
            readings([{"pages": 1}, [row]])

    def test_a_figure_that_is_not_a_number_is_refused(self) -> None:
        with pytest.raises(WorldBankError, match="not a number the world bank could have meant"):
            readings([{"pages": 1}, [_row("RO", "roughly one")]])


def _row(country: str, value: object, series: str = "GOV_WGI_RL.EST") -> dict:
    return {
        "indicator": {"id": series, "value": "Rule of Law"},
        "country": {"id": country, "value": country},
        "countryiso3code": country,
        "date": "2024",
        "value": value,
        "obs_status": "",
        "decimal": 1,
    }


def _one(found: tuple[Reading, ...], country: str, series: str) -> Reading:
    return next(r for r in found if r.country == country and r.series == series)
