"""The OData envelope, and the aggregates hiding inside it.

The captured response carries one row of every `SpatialDimType` WHO publishes alongside the
country rows. That is what these tests are for: the filter that keeps a figure describing forty
countries out of the record of one.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from starnest.data_sources.who import WhoError, readings

CAPTURED = Path(__file__).parent / "captured"


def captured() -> dict:
    return json.loads((CAPTURED / "uhc_index_reported.json").read_text())


class TestWhatCountsAsACountry:
    def test_only_country_rows_become_readings(self) -> None:
        document = captured()
        aggregates = [r for r in document["value"] if r["SpatialDimType"] != "COUNTRY"]

        found = readings(document)

        assert aggregates, "the fixture must contain aggregates or this proves nothing"
        assert len(found) == len(document["value"]) - len(aggregates)

    @pytest.mark.parametrize(
        "kind", ["REGION", "GLOBAL", "WORLDBANKREGION", "WORLDBANKINCOMEGROUP"]
    )
    def test_no_aggregate_of_any_kind_survives(self, kind: str) -> None:
        document = captured()
        codes = {r["SpatialDim"] for r in document["value"] if r["SpatialDimType"] == kind}

        assert codes, f"the fixture must contain a {kind} row or this proves nothing"
        assert codes.isdisjoint({r.country for r in readings(document)})

    def test_a_reading_keeps_the_figure_and_the_year(self) -> None:
        romania = [r for r in readings(captured()) if r.country == "ROU" and r.year == 2023]

        assert len(romania) == 1
        assert romania[0].figure == Decimal("77")


class TestWhatIsNotAFigure:
    def test_a_row_with_no_numeric_value_is_dropped(self) -> None:
        """WHO publishes rows whose figure is absent, and an absent figure is not a zero."""
        found = readings({"value": [_row("ROU", 2023, None), _row("PRT", 2023, 83.0)]})

        assert [r.country for r in found] == ["PRT"]


class TestTheShapesThatAreNotAnAnswer:
    @pytest.mark.parametrize(
        "document",
        [
            pytest.param({"no": "value key"}, id="no value key"),
            pytest.param({"value": "not a list"}, id="value is not a list"),
            pytest.param([], id="an array rather than an object"),
        ],
    )
    def test_something_other_than_the_usual_envelope_is_refused(self, document: object) -> None:
        with pytest.raises(WhoError, match="without its usual value array"):
            readings(document)

    def test_a_row_that_is_not_an_object_is_refused(self) -> None:
        with pytest.raises(WhoError, match="a row that is not an object"):
            readings({"value": ["a string"]})

    def test_a_country_row_naming_no_place_is_refused(self) -> None:
        row = _row("ROU", 2023, 77.0)
        del row["SpatialDim"]

        with pytest.raises(WhoError, match="names no SpatialDim"):
            readings({"value": [row]})

    @pytest.mark.parametrize("year", ["2023", None, True])
    def test_a_period_that_is_not_an_integer_year_is_refused(self, year: object) -> None:
        """WHO publishes some indicators against other period types, and reading one as a year
        would file a figure under the wrong one without saying so. `True` is included because
        it is an `int` in Python and is not a year."""
        row = _row("ROU", 2023, 77.0) | {"TimeDim": year}

        with pytest.raises(WhoError, match="not the integer year"):
            readings({"value": [row]})

    def test_a_figure_that_is_not_a_number_is_refused(self) -> None:
        row = _row("ROU", 2023, 77.0) | {"NumericValue": "about eighty"}

        with pytest.raises(WhoError, match="not a number"):
            readings({"value": [row]})


def _row(country: str, year: int, figure: float | None) -> dict:
    return {
        "IndicatorCode": "UHC_INDEX_REPORTED",
        "SpatialDimType": "COUNTRY",
        "SpatialDim": country,
        "TimeDimType": "YEAR",
        "TimeDim": year,
        "NumericValue": figure,
        "Value": str(figure),
    }
