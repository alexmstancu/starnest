"""Turning a refusal pydantic wrapped back into the domain's own (BE-21).

A domain error raised inside a validator reaches the caller wrapped in a `ValidationError`, which
the error table has no row for -- so building a domain object from a request answered 500 where
the domain had written a sentence. `built_from_the_request` unwraps a refusal the table maps, and
leaves everything else exactly as it was: a native constraint the request body failed to mirror,
or a bug, must stay a loud 500 rather than become a tidy 422 nobody investigates.

And the other half of a malformed request (BE-23): a query parameter no route declares, which
FastAPI would otherwise ignore.
"""

import json
from datetime import date
from decimal import Decimal
from typing import Annotated

import httpx
import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError, model_validator
from starlette.requests import Request

from starnest.api.errors import (
    built_from_the_request,
    domain_error_handler,
    refusal_for,
    refusal_handler,
    refuse_unknown_query_parameters,
    request_validation_handler,
)
from starnest.candidates import MalformedIdentifierError
from starnest.criteria import (
    CriteriaSet,
    Criterion,
    CriterionDeclarationError,
    Goal,
    LabelThreshold,
    NormalisationMethod,
    PillarWeight,
    RangeThreshold,
    ScaleAnchor,
    ShareThreshold,
    ThresholdShapeError,
    WeightedItem,
    rebalance,
)
from starnest.data import InvalidReferencePeriodError, ReferencePeriod, ValueType
from starnest.evaluation import RankingError
from starnest.household import Household, HouseholdPlaceError

NEW_YEARS_DAY, NEW_YEARS_EVE = date(2026, 1, 1), date(2026, 12, 31)


class Unmapped(BaseModel):
    """A model refusing with a `ValueError` nothing in the error table names."""

    figure: int

    @model_validator(mode="after")
    def _refuse(self) -> "Unmapped":
        raise ValueError("a refusal nobody gave a status to")


def a_household(**overrides: object) -> Household:
    fields: dict[str, object] = {
        "net_income": Decimal(5000),
        "number_adults": 2,
        "number_children": 0,
        "home_country_candidate": "country.romania",
        "citizenships": frozenset({"country.romania"}),
    }
    return Household(**(fields | overrides))  # type: ignore[arg-type]


class TestARefusalBuiltFromTheRequest:
    def test_a_domain_refusal_comes_out_as_itself(self) -> None:
        with (
            pytest.raises(InvalidReferencePeriodError, match="ends before it begins") as refused,
            built_from_the_request(),
        ):
            ReferencePeriod(start=NEW_YEARS_EVE, end=NEW_YEARS_DAY)

        assert isinstance(refused.value.__cause__, ValidationError), "the wrapper is kept as cause"

    def test_a_refusal_from_a_nested_field_comes_out_as_itself(self) -> None:
        with pytest.raises(MalformedIdentifierError), built_from_the_request():
            a_household(home_country_candidate="Romania")

    def test_a_refusal_from_a_whole_record_check_comes_out_as_itself(self) -> None:
        with pytest.raises(HouseholdPlaceError, match="madrid"), built_from_the_request():
            a_household(home_city_candidate="city.spain.madrid")

    def test_a_native_constraint_failure_stays_a_validation_error(self) -> None:
        """A bound the request body should have mirrored: a 500 that says the body is wrong."""
        with pytest.raises(ValidationError), built_from_the_request():
            ScaleAnchor(input_value=Decimal(0), score=-1)

    def test_a_mapped_refusal_beside_a_native_failure_stays_a_validation_error(self) -> None:
        """Only when every problem is one the table maps is the first of them the answer;
        otherwise the 422 would describe part of what is wrong and hide the rest."""
        with pytest.raises(ValidationError), built_from_the_request():
            a_household(home_country_candidate="Romania", citizenships=frozenset())

    def test_an_unmapped_refusal_is_left_alone(self) -> None:
        with pytest.raises(ValidationError), built_from_the_request():
            Unmapped(figure=1)

    def test_a_non_validation_error_passes_through(self) -> None:
        with pytest.raises(KeyError), built_from_the_request():
            raise KeyError("not a refusal at all")

    def test_nothing_raised_is_nothing_changed(self) -> None:
        with built_from_the_request():
            period = ReferencePeriod(start=NEW_YEARS_DAY, end=NEW_YEARS_EVE)

        assert period.start == NEW_YEARS_DAY


class TestTheRefusalsTheTableGained:
    @pytest.mark.parametrize(
        ("error", "refusal"),
        [
            (MalformedIdentifierError("Eurostat"), (422, "invalid_request")),
            (
                ThresholdShapeError(
                    "minimum 50 is above maximum 10", fields=("matching_threshold",)
                ),
                (422, "invalid_criterion"),
            ),
            (InvalidReferencePeriodError("backwards"), (422, "invalid_reference_period")),
        ],
        ids=["a malformed identifier", "a threshold of no shape", "a backwards period"],
    )
    def test_the_three_new_classes_have_a_refusal(
        self, error: Exception, refusal: tuple[int, str]
    ) -> None:
        assert refusal_for(error) == refusal


A_REQUEST = Request({"type": "http", "method": "GET", "path": "/v1/anything", "headers": []})


class TestWhatTheHandlersLeaveAlone:
    async def test_an_error_the_table_does_not_map_is_left_to_propagate(self) -> None:
        """An unexpected error is a bug, and a bug reaches the logs as a 500 rather than being
        dressed as a tidy error body nobody investigates."""
        with pytest.raises(ValueError, match="a bug"):
            await domain_error_handler(A_REQUEST, ValueError("a bug, not a refusal"))

    async def test_a_refusal_with_no_code_keeps_the_frameworks_rendering(self) -> None:
        response = await refusal_handler(A_REQUEST, HTTPException(404, detail="Not Found"))

        assert response.status_code == 404
        assert json.loads(bytes(response.body)) == {"detail": "Not Found"}


class TestTheDetailsARefusalCarries:
    """One convention for every domain error: a `details` mapping, rendered as it is (PL-006).

    A client words a refusal from its code and its details, never from the sentence, so the
    specifics a screen needs have to travel as fields.
    """

    async def test_a_domain_errors_details_reach_the_body(self) -> None:
        refused = RankingError("nothing to rank", details={"reason": "scores_nothing"})

        response = await domain_error_handler(A_REQUEST, refused)

        assert json.loads(bytes(response.body))["details"] == {"reason": "scores_nothing"}

    async def test_a_domain_error_with_none_renders_none(self) -> None:
        response = await domain_error_handler(A_REQUEST, RankingError("nothing to rank"))

        assert "details" not in json.loads(bytes(response.body))

    async def test_a_weight_with_nothing_to_absorb_it_says_why_though_no_lock_is_named(
        self,
    ) -> None:
        """PL-112: a pillar of one has no lock in the way, so its refusal used to carry no
        `details` at all, and the screen could only guess -- wrongly -- that a lock was to blame."""
        with pytest.raises(ValueError) as refused:
            rebalance(
                [WeightedItem("only", Decimal(100), locked=False)],
                moved="only",
                to=Decimal(60),
            )

        response = await domain_error_handler(A_REQUEST, refused.value)

        assert response.status_code == 409
        assert json.loads(bytes(response.body))["details"] == {
            "reason": "only_weight",
            "locked": [],
        }


RENT = "country.rent_centre"


def a_rent_set() -> CriteriaSet:
    """One monetary criterion carrying its whole pillar: the smallest set a rule can be put to."""
    rent = Criterion(
        criteria_set="mine",
        attribute=RENT,
        value_type=ValueType.MONETARY,
        pillar="housing",
        weight=Decimal(100),
        goal=Goal.MINIMISE,
    )
    return CriteriaSet(
        id="mine",
        name="Mine",
        criteria=(rent,),
        pillar_weights=(PillarWeight(pillar="housing", level="country", weight=Decimal(100)),),
    )


async def _the_field_problems_of(refusal: Exception) -> list[dict[str, object]]:
    response = await domain_error_handler(A_REQUEST, refusal)
    body = json.loads(bytes(response.body))
    assert (response.status_code, body["code"]) == (422, "invalid_criterion")
    return body["details"]["errors"]


def _named(*fields: str, problem: str, limit: float | None = None) -> list[dict[str, object]]:
    bound = {} if limit is None else {"limit": limit}
    return [
        {"location": ["body", field], "problem": problem, "kind": "invalid_criterion"} | bound
        for field in fields
    ]


class TestARefusedRuleNamesItsFields:
    """PL-026: a refused rule says which of its fields it refused, as a 422 does.

    The same `FieldProblem` list `invalid_request` serves, so a form marks a band the domain
    refused exactly as it marks a figure the boundary refused. Built through
    `with_criterion_scoring`, the path a rule's save takes, so the fields survive pydantic's
    wrapping.
    """

    async def _refusing(self, rule: dict[str, object]) -> list[dict[str, object]]:
        with pytest.raises(CriterionDeclarationError) as refused:
            a_rent_set().with_criterion_scoring(RENT, rule)
        return await self._problems(refused.value)

    async def _problems(self, refusal: Exception) -> list[dict[str, object]]:
        problems = await _the_field_problems_of(refusal)
        assert {problem["problem"] for problem in problems} == {str(refusal)}
        return problems

    async def test_a_band_with_no_top_names_the_missing_bound(self) -> None:
        problems = await self._refusing(
            {"goal": Goal.TARGET_RANGE, "target_range_min": Decimal(500)}
        )

        assert problems == _named("target_range_max", problem=problems[0]["problem"])

    async def test_a_zero_point_inside_the_band_names_both_ends_of_the_contradiction(
        self,
    ) -> None:
        problems = await self._refusing(
            {
                "goal": Goal.TARGET_RANGE,
                "target_range_min": Decimal(500),
                "target_range_max": Decimal(900),
                "zero_score_below": Decimal(600),
            }
        )

        assert problems == _named(
            "target_range_min", "zero_score_below", problem=problems[0]["problem"]
        )

    async def test_a_band_the_method_cannot_draw_names_the_goal_and_the_method(self) -> None:
        problems = await self._refusing(
            {
                "goal": Goal.TARGET_RANGE,
                "target_range_min": Decimal(500),
                "target_range_max": Decimal(900),
                "normalisation_method": NormalisationMethod.PERCENTILE,
            }
        )

        assert problems == _named("goal", "normalisation_method", problem=problems[0]["problem"])

    async def test_anchors_against_the_goal_name_the_goal_and_the_anchors(self) -> None:
        problems = await self._refusing(
            {
                "scale_anchors": (
                    ScaleAnchor(input_value=Decimal(500), score=0),
                    ScaleAnchor(input_value=Decimal(1500), score=100),
                )
            }
        )

        assert problems == _named("goal", "scale_anchors", problem=problems[0]["problem"])

    async def test_a_goal_no_rule_has_is_named_where_it_was_sent(self) -> None:
        problems = await self._refusing({"goal": "sideways"})

        assert problems == _named("goal", problem=problems[0]["problem"])

    async def test_an_anchor_above_the_scale_names_the_anchors_and_the_ceiling(self) -> None:
        anchored = a_rent_set().with_criterion_scoring(
            RENT,
            {
                "scale_anchors": (
                    ScaleAnchor(input_value=Decimal(500), score=150),
                    ScaleAnchor(input_value=Decimal(1500), score=0),
                )
            },
        )
        with pytest.raises(CriterionDeclarationError) as refused:
            anchored.refuse_unless_its_anchors_fit(100)

        problems = await self._problems(refused.value)

        assert problems == _named("scale_anchors", problem=problems[0]["problem"], limit=100)

    async def test_a_threshold_of_the_wrong_shape_names_the_threshold(self) -> None:
        problems = await self._refusing(
            {"matching_threshold": LabelThreshold(label="Cfb", containment_rule="must_contain")}
        )

        assert problems == _named("matching_threshold", problem=problems[0]["problem"])

    async def test_a_backwards_threshold_names_the_threshold(self) -> None:
        with pytest.raises(ValidationError) as wrapped:
            RangeThreshold(min_value=Decimal(50), max_value=Decimal(10))

        problems = await self._problems(wrapped.value.errors()[0]["ctx"]["error"])

        assert problems == _named("matching_threshold", problem=problems[0]["problem"])

    async def test_a_share_beyond_a_hundred_names_the_threshold_and_the_bound(self) -> None:
        with pytest.raises(ValidationError) as wrapped:
            ShareThreshold(label="owned", max_share=Decimal(120))

        problems = await self._problems(wrapped.value.errors()[0]["ctx"]["error"])

        assert problems == _named("matching_threshold", problem=problems[0]["problem"], limit=100)

    async def test_the_details_a_refusal_already_carried_are_kept_beside_its_fields(
        self,
    ) -> None:
        refused = CriterionDeclarationError(
            "above the scale", fields=("scale_anchors",), details={"reason": "anchor_above_scale"}
        )

        response = await domain_error_handler(A_REQUEST, refused)

        assert json.loads(bytes(response.body))["details"] == {
            "reason": "anchor_above_scale",
            "errors": _named("scale_anchors", problem="above the scale"),
        }

    async def test_a_refusal_naming_no_field_lists_none(self) -> None:
        refused = CriterionDeclarationError("about no field", fields=())

        response = await domain_error_handler(A_REQUEST, refused)

        assert "details" not in json.loads(bytes(response.body))


def _paging(page: int = 1, page_size: Annotated[int, Query(alias="page-size")] = 10) -> int:
    """A dependency declaring query parameters of its own, one of them under an alias."""
    return page * page_size


def an_app_refusing_unknown_query_parameters() -> FastAPI:
    """The wiring `build_app` uses, around routes small enough to read at a glance."""
    router = APIRouter()

    @router.get("/things")
    async def things(level: str | None = None, paged: int = Depends(_paging)) -> dict:
        return {"level": level, "paged": paged}

    @router.post("/things")
    async def add_a_thing() -> dict:
        return {}

    @router.get("/bounded")
    async def bounded(
        at_most: Annotated[int, Query(le=20)] = 1,
        since: Annotated[date, Query(ge=NEW_YEARS_DAY)] = NEW_YEARS_EVE,
    ) -> dict:
        return {}

    app = FastAPI()
    app.add_exception_handler(RequestValidationError, request_validation_handler)
    app.include_router(router, dependencies=[Depends(refuse_unknown_query_parameters)])
    return app


async def _get(path: str, method: str = "GET") -> httpx.Response:
    transport = httpx.ASGITransport(app=an_app_refusing_unknown_query_parameters())
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        return await client.request(method, path)


class TestAQueryParameterNobodyDeclared:
    """FastAPI ignores a query parameter no route declares (BE-23), so a misspelled one answered
    as though it had not been sent and a filter the server does not apply returned everything
    unfiltered."""

    async def test_one_the_route_declares_is_taken(self) -> None:
        response = await _get("/things?level=country")

        assert (response.status_code, response.json()["level"]) == (200, "country")

    async def test_one_a_dependency_declares_is_taken(self) -> None:
        """Declared is declared wherever it is, including inside a sub-dependency."""
        response = await _get("/things?page=3")

        assert (response.status_code, response.json()["paged"]) == (200, 30)

    async def test_one_declared_under_an_alias_is_taken_by_its_alias(self) -> None:
        response = await _get("/things?page-size=2")

        assert (response.status_code, response.json()["paged"]) == (200, 2)

    async def test_an_alias_s_python_name_is_not_a_parameter(self) -> None:
        response = await _get("/things?page_size=2")

        assert response.status_code == 422

    async def test_one_nobody_declared_is_refused_in_the_one_error_shape(self) -> None:
        response = await _get("/things?levle=country")

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "invalid_request"
        assert body["details"]["errors"] == [
            {
                "location": ["query", "levle"],
                "problem": "Extra inputs are not permitted",
                "kind": "extra_forbidden",
            }
        ]

    async def test_every_one_nobody_declared_is_named_at_once(self) -> None:
        response = await _get("/things?verbose=1&level=country&sort=name&sort=id")

        assert [error["location"] for error in response.json()["details"]["errors"]] == [
            ["query", "verbose"],
            ["query", "sort"],
        ]

    async def test_a_route_that_takes_none_refuses_any(self) -> None:
        assert (await _get("/things?dry_run=true", method="POST")).status_code == 422

    async def test_a_route_sent_none_is_untouched(self) -> None:
        assert (await _get("/things", method="POST")).status_code == 200


class TestAFieldProblem:
    """What each entry of `details.errors` says, so a form can word it without the sentence."""

    async def test_a_numeric_bound_names_its_kind_and_its_limit(self) -> None:
        (problem,) = (await _get("/bounded?at_most=21")).json()["details"]["errors"]

        assert (problem["location"], problem["kind"], problem["limit"]) == (
            ["query", "at_most"],
            "less_than_equal",
            20,
        )

    async def test_a_bound_that_is_not_a_number_is_not_sent_as_a_limit(self) -> None:
        """A date's bound is a `date` object in `ctx`, which would not even serialise."""
        (problem,) = (await _get("/bounded?since=2025-12-31")).json()["details"]["errors"]

        assert problem["kind"] == "greater_than_equal"
        assert "limit" not in problem

    async def test_a_refusal_with_no_bound_carries_no_limit(self) -> None:
        (problem,) = (await _get("/bounded?at_most=many")).json()["details"]["errors"]

        assert problem["kind"] == "int_parsing"
        assert "limit" not in problem
