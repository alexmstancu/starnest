"""Reading Eurostat's cube, against responses actually captured from the live API.

`captured/` holds two real JSON-stat documents. Fixtures rather than a live call because a test
that reaches the network fails when Eurostat is down, which says nothing about this code -- and
because the shape is what is under test, and the shape does not change between runs.

The sad paths are hand-built, because a malformed response is exactly what the API will not
give us on demand.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from starnest.data_sources.eurostat.jsonstat import JsonStatError, Observation, observations

CAPTURED = Path(__file__).parent / "captured"

HOUSING_COST_OVERBURDEN = "ilc_lvho07a"
LIFE_SATISFACTION = "ilc_pw01"


def captured(dataset: str) -> dict:
    return json.loads((CAPTURED / f"{dataset}.json").read_text())


def a_cube(*, values: dict[str, float] | list, status: dict[str, str] | None = None) -> dict:
    """A two-country, two-year cube with one degenerate dimension in front of them.

    The leading dimension is there on purpose: with only `geo` and `time` the stride arithmetic
    is trivially right, and Eurostat always sends several.
    """
    return {
        "id": ["unit", "geo", "time"],
        "size": [1, 2, 2],
        "dimension": {
            "unit": {"category": {"index": {"PC": 0}}},
            "geo": {"category": {"index": {"PT": 0, "ES": 1}}},
            "time": {"category": {"index": {"2023": 0, "2024": 1}}},
        },
        "value": values,
        **({"status": status} if status else {}),
    }


class TestReadingTheCaptured:
    def test_every_observation_the_response_carries_comes_back(self) -> None:
        assert len(observations(captured(HOUSING_COST_OVERBURDEN))) == 179

    def test_a_figure_is_attached_to_the_right_country_and_year(self) -> None:
        """The check that matters most: a stride error attaches every figure to the wrong
        country and looks entirely plausible doing it.

        These three were confirmed by decoding the flat index by hand out of the raw response --
        `geo_position * len(time) + time_position` -- rather than by reading them back out of
        the parser, which would only have proved it agrees with itself.
        """
        found = {
            (o.geo, o.period): o.figure for o in observations(captured(HOUSING_COST_OVERBURDEN))
        }

        assert found[("PT", "2024")] == Decimal("6.9")
        assert found[("EL", "2024")] == Decimal("28.9")
        assert found[("DE", "2024")] == Decimal("12.0")

    def test_figures_are_decimals_and_never_floats(self) -> None:
        """`Decimal(7.1)` is 7.0999999999999996; `Decimal("7.1")` is 7.1 (`arch.md` 9.6)."""
        figures = [o.figure for o in observations(captured(LIFE_SATISFACTION))]

        assert all(isinstance(figure, Decimal) for figure in figures)
        assert Decimal("7.1") in figures

    def test_countries_that_did_not_report_are_simply_absent(self) -> None:
        """The gap is the signal. Eurostat leaves the index out; so do we (`reqs.md` 5.3)."""
        cube = captured(HOUSING_COST_OVERBURDEN)
        declared = set(cube["dimension"]["geo"]["category"]["index"])
        reported_2024 = {o.geo for o in observations(cube) if o.period == "2024"}

        assert reported_2024 < declared
        assert len(reported_2024) == 35

    def test_eurostat_flags_travel_with_the_figure(self) -> None:
        """A provisional figure is a different thing to display than a settled one."""
        flagged = [o for o in observations(captured(HOUSING_COST_OVERBURDEN)) if o.flag]

        assert flagged, "the captured response carries flagged observations"
        assert {o.flag for o in flagged} <= {"p", "b", "e", "d", "u"}


class TestDecodingTheCube:
    def test_a_sparse_object_decodes_each_index_to_its_own_cell(self) -> None:
        found = observations(a_cube(values={"0": 1.5, "3": 9.5}))

        assert found == (
            Observation(geo="PT", period="2023", figure=Decimal("1.5")),
            Observation(geo="ES", period="2024", figure=Decimal("9.5")),
        )

    def test_a_dense_array_with_gaps_decodes_the_same_way(self) -> None:
        """JSON-stat permits both forms. Reading only the object would silently return nothing
        for a response in the other."""
        assert observations(a_cube(values=[1.5, None, None, 9.5])) == observations(
            a_cube(values={"0": 1.5, "3": 9.5})
        )

    def test_codes_are_ordered_by_position_and_not_by_key(self) -> None:
        """`category.index` maps code to position and arrives in no guaranteed order.

        Iterating it in key order would attach every figure to the wrong country, plausibly.
        """
        reversed_order = a_cube(values={"0": 1.5})
        reversed_order["dimension"]["geo"]["category"]["index"] = {"ES": 1, "PT": 0}

        assert observations(reversed_order)[0].geo == "PT"

    def test_a_flag_is_matched_to_its_own_observation(self) -> None:
        found = observations(a_cube(values={"0": 1.5, "3": 9.5}, status={"3": "p"}))

        assert [o.flag for o in found] == [None, "p"]


class TestAResponseThatCannotBeRead:
    def test_a_response_with_no_values_is_refused(self) -> None:
        cube = a_cube(values={})
        del cube["value"]

        with pytest.raises(JsonStatError, match="no `value`"):
            observations(cube)

    def test_a_response_with_no_geo_dimension_is_refused(self) -> None:
        """An observation that cannot be attached to a place is not one we can store."""
        cube = a_cube(values={"0": 1.5})
        cube["id"] = ["unit", "region", "time"]

        with pytest.raises(JsonStatError, match="no `geo` dimension"):
            observations(cube)

    def test_a_response_with_no_time_dimension_is_refused(self) -> None:
        """Two dates per value, never merged (`reqs.md` 3.6). A figure with no period has no
        reference date, and a retrieval date alone is not provenance."""
        cube = a_cube(values={"0": 1.5})
        cube["id"] = ["unit", "geo", "vintage"]

        with pytest.raises(JsonStatError, match="no `time` dimension"):
            observations(cube)

    def test_sizes_that_do_not_match_the_dimensions_are_refused(self) -> None:
        """The stride arithmetic would still produce numbers, for the wrong cells."""
        cube = a_cube(values={"0": 1.5})
        cube["size"] = [1, 2]

        with pytest.raises(JsonStatError, match="cannot be read"):
            observations(cube)

    def test_a_response_naming_no_dimensions_is_refused(self) -> None:
        cube = a_cube(values={"0": 1.5})
        cube["id"] = []

        with pytest.raises(JsonStatError, match="names no dimensions"):
            observations(cube)

    def test_a_dimension_with_no_category_index_is_refused(self) -> None:
        cube = a_cube(values={"0": 1.5})
        cube["dimension"]["geo"] = {}

        with pytest.raises(JsonStatError, match="no category index"):
            observations(cube)

    def test_a_figure_that_is_not_a_number_is_refused(self) -> None:
        """Better than storing the string: a value nobody can compare is not a measurement."""
        with pytest.raises(JsonStatError, match="not a figure"):
            observations(a_cube(values={"0": "not a number"}))
