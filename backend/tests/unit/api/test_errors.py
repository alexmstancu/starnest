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
from starnest.criteria import ScaleAnchor, ThresholdShapeError
from starnest.data import InvalidReferencePeriodError, ReferencePeriod
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
            (ThresholdShapeError("minimum 50 is above maximum 10"), (422, "invalid_criterion")),
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
            {"location": ["query", "levle"], "problem": "Extra inputs are not permitted"}
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
