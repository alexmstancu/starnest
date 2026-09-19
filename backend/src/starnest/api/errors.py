"""One error shape, and the single place a domain fault becomes a status code.

`arch.md` 7.6. A client branches on `code`, never on prose -- so the code is part of the
contract and the message is not, and the mapping from an exception to a status lives here rather
than in each endpoint. Scattered `try`/`except HTTPException` is how two endpoints come to
report the same fault differently.

**The domain raises domain errors and knows nothing about HTTP.** `criteria/` raises
`WeightsAllLockedError` because that is what happened; that it becomes a 409 is a fact about the
REST surface, and this module is the REST surface's opinion.
"""

from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from starnest.candidates import UnknownCandidateError
from starnest.comparison import ComparisonError
from starnest.criteria import (
    CriteriaSetError,
    CriteriaSetExistsError,
    CriteriaSetInUseError,
    CriterionDeclarationError,
    UnknownCriteriaSetError,
    UnknownCriterionError,
    WeightsAllLockedError,
)
from starnest.data import (
    InvalidManualValueError,
    MalformedMatchRuleResultError,
    ManualEntryNotPermittedError,
    UnknownAttributeError,
    UnknownDataSourceError,
    UnknownMatchRuleError,
)
from starnest.data_acquisition import (
    NoResearcherConfiguredError,
    NothingToAskAgainError,
    NothingToFetchError,
    NothingToRetryError,
    RunAlreadyInFlightError,
    SpendCapNotSetError,
    UnknownRunError,
)
from starnest.evaluation import NormalisationError, RankingError, UnknownEvaluationError
from starnest.household import HouseholdNotConfiguredError, HouseholdPlaceError


class ErrorBody(BaseModel):
    """The shape every failure takes, whatever went wrong."""

    code: str = Field(description="Stable and machine-readable. Branch on this, never on prose.")
    message: str
    details: dict[str, Any] | None = None


def _refusal(status: int, code: str) -> tuple[int, str]:
    return status, code


STATUS_FOR: Mapping[type[Exception], tuple[int, str]] = {
    # 404 -- named something that is not there.
    UnknownCriteriaSetError: _refusal(404, "not_found"),
    UnknownCriterionError: _refusal(404, "not_found"),
    UnknownAttributeError: _refusal(404, "not_found"),
    UnknownRunError: _refusal(404, "not_found"),
    UnknownEvaluationError: _refusal(404, "not_found"),
    UnknownCandidateError: _refusal(404, "not_found"),
    UnknownMatchRuleError: _refusal(404, "not_found"),
    HouseholdNotConfiguredError: _refusal(404, "household_not_configured"),
    # 409 -- the request is well formed and the state refuses it.
    WeightsAllLockedError: _refusal(409, "weights_all_locked"),
    CriteriaSetExistsError: _refusal(409, "criteria_set_exists"),
    CriteriaSetInUseError: _refusal(409, "criteria_set_in_use"),
    NothingToRetryError: _refusal(409, "nothing_to_retry"),
    NothingToAskAgainError: _refusal(409, "nothing_to_ask_again"),
    SpendCapNotSetError: _refusal(409, "spend_cap_not_set"),
    NothingToFetchError: _refusal(409, "nothing_to_fetch"),
    RunAlreadyInFlightError: _refusal(409, "run_already_in_flight"),
    NoResearcherConfiguredError: _refusal(501, "llm_not_configured"),
    ManualEntryNotPermittedError: _refusal(409, "manual_entry_not_permitted"),
    InvalidManualValueError: _refusal(409, "invalid_value"),
    # 422 -- the request describes something the domain will not accept.
    CriteriaSetError: _refusal(422, "invalid_criteria_set"),
    CriterionDeclarationError: _refusal(422, "invalid_criterion"),
    HouseholdPlaceError: _refusal(422, "unknown_place"),
    NormalisationError: _refusal(422, "cannot_be_scored"),
    RankingError: _refusal(422, "cannot_be_ranked"),
    ComparisonError: _refusal(409, "invalid_comparison"),
    MalformedMatchRuleResultError: _refusal(422, "invalid_match_rule_result"),
    UnknownDataSourceError: _refusal(422, "unknown_data_source"),
}
"""Which domain fault is which kind of refusal.

A table rather than a chain of `except` clauses, so adding a domain error is one line and the
whole mapping can be read at once. **Order matters**: `WeightsAllLockedError` is a
`CriteriaSetError`, so the lookup below walks the class's own MRO and takes the first match --
the most specific rule wins, which is the one that carries the code the contract names.
"""


def refusal_for(error: Exception) -> tuple[int, str] | None:
    """The status and code for a domain error, or None when it is not one we translate.

    Walks the MRO so a subclass inherits its parent's refusal unless it declares its own. An
    error with no entry is not turned into a 500 here: it is left to propagate, because an
    unexpected exception is a bug and dressing it as a tidy error body is how a bug becomes a
    feature nobody investigates.
    """
    for kind in type(error).__mro__:
        if kind in STATUS_FOR:
            return STATUS_FOR[kind]
    return None


async def domain_error_handler(request: Request, error: Exception) -> JSONResponse:
    """Render a domain fault in the one shape, with the details it carries."""
    refusal = refusal_for(error)
    if refusal is None:
        raise error
    status, code = refusal
    return JSONResponse(
        status_code=status,
        content=ErrorBody(code=code, message=str(error), details=_details_of(error)).model_dump(
            exclude_none=True
        ),
    )


def _details_of(error: Exception) -> dict[str, Any] | None:
    """The offending field, where the error carries one.

    `WeightsAllLockedError` knows which locks were in the way, and the screen names them
    (`reqs.md` 5.2). A message a user cannot act on is barely better than no message.
    """
    locked = getattr(error, "locked", None)
    if locked:
        return {"locked": [str(attribute) for attribute in locked]}
    return None


async def refusal_handler(request: Request, error: Exception) -> JSONResponse:
    """A refusal an endpoint raises itself, rendered in the one error shape.

    `arch.md` 7.6 gives this API one error shape -- `code`, `message`, optional `details` -- and
    `HTTPException` renders its payload under `detail` instead, so an endpoint raising one
    answered in a shape no client was told about while every domain fault answered correctly.
    A refusal whose payload already carries a `code` is re-rendered flat; anything else (a 404
    from the framework, say) keeps FastAPI's own rendering.
    """
    assert isinstance(error, HTTPException)
    if not isinstance(error.detail, dict) or "code" not in error.detail:
        return await http_exception_handler(request, error)
    return JSONResponse(status_code=error.status_code, content=dict(error.detail))
