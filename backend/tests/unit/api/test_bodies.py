"""A request body that changes only what it carries, and the nulls it will not take (BE-23).

**Absent and null are different claims.** A field left out of a partial change means "leave it
as it is"; a field sent as null means "make it null" -- which is a value only where the design
gives it one, like a band's bound or a threshold, where null clears. Everywhere else a null used
to be coerced into something nobody sent: `scale_anchors: null` cleared the anchors and
`required_value: null` became `false`.
"""

from decimal import Decimal
from typing import Any, ClassVar

import pytest
from pydantic import ValidationError

from starnest.api.bodies import PartialChangeBody
from starnest.api.catalog import DataSourceInput
from starnest.api.criteria import CriterionInput, PillarWeightInput, ThresholdBody


class AChange(PartialChangeBody):
    """A partial change with one field of each kind: null refused, and null meaning "clear"."""

    not_nullable: ClassVar[frozenset[str]] = frozenset({"weight", "is_scored", "anchors"})

    weight: Decimal | None = None
    is_scored: bool | None = None
    anchors: tuple[int, ...] | None = None
    bound: Decimal | None = None


def _refusal(body: type[PartialChangeBody], sent: dict[str, Any]) -> list[tuple]:
    with pytest.raises(ValidationError) as refused:
        body.model_validate(sent)
    return [(problem["type"], problem["loc"]) for problem in refused.value.errors()]


class TestWhatAPartialChangeTakes:
    def test_a_field_left_out_is_no_change(self) -> None:
        assert AChange.model_validate({}).model_fields_set == set()

    def test_a_null_the_design_gives_no_meaning_is_refused_and_named(self) -> None:
        assert _refusal(AChange, {"weight": None}) == [("null_not_allowed", ("weight",))]

    def test_every_such_null_is_named_at_once(self) -> None:
        assert _refusal(AChange, {"weight": None, "is_scored": None, "anchors": None}) == [
            ("null_not_allowed", ("weight",)),
            ("null_not_allowed", ("is_scored",)),
            ("null_not_allowed", ("anchors",)),
        ]

    def test_a_null_the_design_gives_a_meaning_is_still_taken(self) -> None:
        """A bound sent as null clears it, which is what the design says null means there."""
        change = AChange.model_validate({"bound": None})

        assert change.model_fields_set == {"bound"}
        assert change.bound is None

    def test_a_value_is_taken_as_it_always_was(self) -> None:
        change = AChange.model_validate({"weight": 40, "is_scored": False, "anchors": []})

        assert (change.weight, change.is_scored, change.anchors) == (Decimal(40), False, ())

    def test_a_field_nobody_declared_is_refused(self) -> None:
        assert _refusal(AChange, {"wieght": 40}) == [("extra_forbidden", ("wieght",))]


class TestWhatTheGeneratedContractSays:
    """The generated contract is the truth (`docs/openapi.implemented.yaml`), so a field that
    refuses null must not be described as taking one."""

    def test_a_field_that_refuses_null_is_not_described_as_nullable(self) -> None:
        properties = AChange.model_json_schema()["properties"]

        assert properties["is_scored"]["type"] == "boolean"
        assert {"type": "null"} not in properties["weight"]["anyOf"]
        assert properties["anchors"]["type"] == "array"

    def test_a_field_that_takes_null_still_says_so(self) -> None:
        assert {"type": "null"} in AChange.model_json_schema()["properties"]["bound"]["anyOf"]

    def test_unknown_fields_are_described_as_refused(self) -> None:
        assert AChange.model_json_schema()["additionalProperties"] is False


NULLS_THE_DESIGN_NEVER_GIVES = pytest.mark.parametrize(
    ("body", "field"),
    [
        (CriterionInput, "is_scored"),
        (CriterionInput, "weight"),
        (CriterionInput, "weight_locked"),
        (CriterionInput, "goal"),
        (CriterionInput, "normalisation_method"),
        (CriterionInput, "blocks_if_missing"),
        (CriterionInput, "scale_anchors"),
        (ThresholdBody, "required_value"),
        (ThresholdBody, "labels"),
        (ThresholdBody, "label"),
        (PillarWeightInput, "weight"),
        (PillarWeightInput, "weight_locked"),
        (DataSourceInput, "is_enabled"),
        (DataSourceInput, "default_priority"),
    ],
)
"""Every field `docs/openapi.yaml` types without a null on the bodies that change part of a
record. Each used to be either coerced into a value nobody sent or ignored as if absent."""


class TestTheBodiesThatChangePartOfARecord:
    @NULLS_THE_DESIGN_NEVER_GIVES
    def test_a_null_is_refused_as_a_null(self, body: type[PartialChangeBody], field: str) -> None:
        assert _refusal(body, {field: None}) == [("null_not_allowed", (field,))]

    @pytest.mark.parametrize(
        "field",
        [
            "target_range_min",
            "target_range_max",
            "zero_score_below",
            "zero_score_above",
            "breakdown_option",
            "reducer_mode",
            "matching_threshold",
        ],
    )
    def test_a_null_that_clears_a_criterion_field_is_still_taken(self, field: str) -> None:
        """Null is how a bound, an option, a reducer or a threshold is removed, and the only
        way: leaving the field out leaves it as it is."""
        assert CriterionInput.model_validate({field: None}).model_fields_set == {field}

    @pytest.mark.parametrize("bound", ["min_value", "max_value", "min_share", "max_share"])
    def test_a_null_bound_on_a_threshold_is_still_taken(self, bound: str) -> None:
        """A range open on one side is a range with a null bound (`criteria/thresholds.py`)."""
        assert ThresholdBody.model_validate({bound: None}).model_fields_set == {bound}

    def test_a_null_inside_a_threshold_is_named_where_it_sits(self) -> None:
        assert _refusal(CriterionInput, {"matching_threshold": {"required_value": None}}) == [
            ("null_not_allowed", ("matching_threshold", "required_value"))
        ]
