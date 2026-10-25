"""One error shape, and the single place a domain fault becomes a status code.

`arch.md` 7.6. A client branches on `code`, never on prose -- so the code is part of the
contract and the message is not, and the mapping from an exception to a status lives here rather
than in each endpoint. Scattered `try`/`except HTTPException` is how two endpoints come to
report the same fault differently.

**The domain raises domain errors and knows nothing about HTTP.** `criteria/` raises
`WeightsAllLockedError` because that is what happened; that it becomes a 409 is a fact about the
REST surface, and this module is the REST surface's opinion.
"""

from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from decimal import Decimal
from enum import StrEnum
from typing import Any, ClassVar

from fastapi import HTTPException, Request
from fastapi.dependencies.models import Dependant
from fastapi.dependencies.utils import get_validation_alias
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import Field, ValidationError

from starnest.api.bodies import ContractBody
from starnest.candidates import MalformedIdentifierError, UnknownCandidateError
from starnest.comparison import ComparatorLimitExceededError, ComparisonError
from starnest.criteria import (
    CriteriaSetError,
    CriteriaSetExistsError,
    CriteriaSetNameTakenError,
    CriterionDeclarationError,
    NoDefaultCriteriaSetError,
    ScoreScaleBelowAnchorsError,
    ThresholdShapeError,
    UnknownCriteriaSetError,
    UnknownCriterionError,
    WeightsAllLockedError,
)
from starnest.data import (
    AnswerRecordedByAPersonError,
    ConflictingObservationError,
    InvalidManualValueError,
    InvalidReferencePeriodError,
    InvalidSourceOrderError,
    MalformedMatchRuleResultError,
    ManualEntryNotPermittedError,
    ManualEntrySwitchedOffError,
    NoSuchDataSourceError,
    UnknownAttributeError,
    UnknownCompoundRuleError,
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


class ErrorCode(StrEnum):
    """Every refusal this API makes, by code: the list `docs/openapi.yaml` calls `ErrorCode`.

    A client words each code and branches on it, so a code the server sends and the contract does
    not list is one no client can word. A new refusal adds its code to both lists, and
    `tests/unit/api/test_error_codes.py` fails until it does (PL-003).
    """

    NOT_FOUND = "not_found"
    CANDIDATE_NOT_FOUND = "candidate_not_found"
    HOUSEHOLD_NOT_CONFIGURED = "household_not_configured"
    WEIGHTS_ALL_LOCKED = "weights_all_locked"
    CRITERIA_SET_EXISTS = "criteria_set_exists"
    CRITERIA_SET_NAME_TAKEN = "criteria_set_name_taken"
    NO_DEFAULT_CRITERIA_SET = "no_default_criteria_set"
    NOTHING_TO_RETRY = "nothing_to_retry"
    NOTHING_TO_ASK_AGAIN = "nothing_to_ask_again"
    SPEND_CAP_NOT_SET = "spend_cap_not_set"
    NOTHING_TO_FETCH = "nothing_to_fetch"
    RUN_ALREADY_IN_FLIGHT = "run_already_in_flight"
    LLM_NOT_CONFIGURED = "llm_not_configured"
    MANUAL_ENTRY_NOT_PERMITTED = "manual_entry_not_permitted"
    MANUAL_ENTRY_SWITCHED_OFF = "manual_entry_switched_off"
    INVALID_VALUE = "invalid_value"
    CONFLICTING_OBSERVATION = "conflicting_observation"
    ANSWER_RECORDED_BY_A_PERSON = "answer_recorded_by_a_person"
    SCORE_SCALE_NOT_SET = "score_scale_not_set"
    SCORE_SCALE_BELOW_ANCHORS = "score_scale_below_anchors"
    COMPARATOR_LIMIT_NOT_SET = "comparator_limit_not_set"
    COMPARATOR_LIMIT_EXCEEDED = "comparator_limit_exceeded"
    INVALID_COMPARISON = "invalid_comparison"
    INVALID_CRITERIA_SET = "invalid_criteria_set"
    INVALID_CRITERION = "invalid_criterion"
    UNKNOWN_PLACE = "unknown_place"
    INVALID_REFERENCE_PERIOD = "invalid_reference_period"
    INVALID_REQUEST = "invalid_request"
    CANNOT_BE_SCORED = "cannot_be_scored"
    CANNOT_BE_RANKED = "cannot_be_ranked"
    INVALID_MATCH_RULE_RESULT = "invalid_match_rule_result"
    UNKNOWN_DATA_SOURCE = "unknown_data_source"
    UNKNOWN_SCOPE = "unknown_scope"
    INVALID_SOURCE_ORDER = "invalid_source_order"


class ErrorBody(ContractBody):
    """The shape every failure takes, whatever went wrong. `details` is left out, never null."""

    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"details"})

    code: ErrorCode = Field(
        description="Stable and machine-readable. Branch on this, never on prose."
    )
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
    UnknownCompoundRuleError: _refusal(404, "not_found"),
    NoSuchDataSourceError: _refusal(404, "not_found"),
    UnknownMatchRuleError: _refusal(404, "not_found"),
    HouseholdNotConfiguredError: _refusal(404, "household_not_configured"),
    # 409 -- the request is well formed and the state refuses it.
    WeightsAllLockedError: _refusal(409, "weights_all_locked"),
    CriteriaSetExistsError: _refusal(409, "criteria_set_exists"),
    CriteriaSetNameTakenError: _refusal(409, "criteria_set_name_taken"),
    ScoreScaleBelowAnchorsError: _refusal(409, "score_scale_below_anchors"),
    NoDefaultCriteriaSetError: _refusal(409, "no_default_criteria_set"),
    NothingToRetryError: _refusal(409, "nothing_to_retry"),
    NothingToAskAgainError: _refusal(409, "nothing_to_ask_again"),
    SpendCapNotSetError: _refusal(409, "spend_cap_not_set"),
    NothingToFetchError: _refusal(409, "nothing_to_fetch"),
    RunAlreadyInFlightError: _refusal(409, "run_already_in_flight"),
    NoResearcherConfiguredError: _refusal(501, "llm_not_configured"),
    ManualEntryNotPermittedError: _refusal(409, "manual_entry_not_permitted"),
    ManualEntrySwitchedOffError: _refusal(409, "manual_entry_switched_off"),
    InvalidManualValueError: _refusal(409, "invalid_value"),
    ConflictingObservationError: _refusal(409, "conflicting_observation"),
    AnswerRecordedByAPersonError: _refusal(409, "answer_recorded_by_a_person"),
    # 422 -- the request describes something the domain will not accept.
    CriteriaSetError: _refusal(422, "invalid_criteria_set"),
    CriterionDeclarationError: _refusal(422, "invalid_criterion"),
    ThresholdShapeError: _refusal(422, "invalid_criterion"),
    HouseholdPlaceError: _refusal(422, "unknown_place"),
    InvalidReferencePeriodError: _refusal(422, "invalid_reference_period"),
    # An identifier that cannot be one is a malformed request (`arch.md` 7.3).
    MalformedIdentifierError: _refusal(422, "invalid_request"),
    NormalisationError: _refusal(422, "cannot_be_scored"),
    RankingError: _refusal(422, "cannot_be_ranked"),
    ComparatorLimitExceededError: _refusal(409, "comparator_limit_exceeded"),
    ComparisonError: _refusal(409, "invalid_comparison"),
    MalformedMatchRuleResultError: _refusal(422, "invalid_match_rule_result"),
    UnknownDataSourceError: _refusal(422, "unknown_data_source"),
    InvalidSourceOrderError: _refusal(422, "invalid_source_order"),
}
"""Which domain fault is which kind of refusal.

A table rather than a chain of `except` clauses, so adding a domain error is one line and the
whole mapping can be read at once. **Order matters**: `WeightsAllLockedError` is a
`CriteriaSetError`, so the lookup below walks the class's own MRO and takes the first match --
the most specific rule wins, which is the one that carries the code the contract names.
"""


def absent(named: Iterable[str] | None, known: set[str]) -> list[str]:
    """Named ids that are not in the known set, order preserved; empty when none are named.

    `None` means the scope named nothing in this dimension -- a full sweep, which names no id and
    so has none to be unknown. That is not the same as `[]`, and conflating them would turn a
    sweep into a refusal.
    """
    if named is None:
        return []
    return [identifier for identifier in named if identifier not in known]


def unknown_scope_refusal(level: str, **groups: list[str]) -> HTTPException:
    """The one refusal for a scope naming ids no row answers to at its level (BE-24).

    `groups` maps a dimension -- `candidates`, `attributes`, `match_rules` -- to the unknown ids
    named in it. Shared by the run and research endpoints so both refuse in one shape and list
    every unknown at once, rather than each silently narrowing its scope to what happens to
    exist and then fetching, or paying, for less than was asked.
    """
    named = [identifier for ids in groups.values() for identifier in ids]
    details: dict[str, Any] = {"level": level}
    details.update({dimension: ids for dimension, ids in groups.items() if ids})
    return HTTPException(
        status_code=422,
        detail={
            "code": "unknown_scope",
            "message": (
                f"the scope names {len(named)} id(s) that exist at no row at level {level}: "
                f"{', '.join(named)}. Nothing runs until every named id exists."
            ),
            "details": details,
        },
    )


@contextmanager
def built_from_the_request() -> Iterator[None]:
    """Build a domain object from request input, letting a refusal it raises answer as itself.

    Pydantic wraps the error a validator raises in a `ValidationError` -- itself a `ValueError`,
    and one this table has no row for -- so a domain refusal raised while the object was being
    built reached the client as a 500 rather than as the sentence the domain wrote (BE-21). When
    every problem in the wrapper is a refusal the table maps, the first of them is raised instead.

    **Anything else is left exactly as it was.** A native constraint failing means a request
    body forgot to mirror a domain bound, and an unmapped error is a bug: both stay a loud 500
    rather than a tidy 422 nobody investigates. Only construction from what the client sent
    belongs inside this -- a stored row that no longer builds is our fault, not a bad request.
    """
    try:
        yield
    except ValidationError as wrapped:
        refusal = _the_refusal_inside(wrapped)
        if refusal is None:
            raise
        raise refusal from wrapped


def _the_refusal_inside(wrapped: ValidationError) -> Exception | None:
    """The first domain error pydantic wrapped, when every problem it reports is one we map."""
    refusals = [problem.get("ctx", {}).get("error") for problem in wrapped.errors()]
    every_one_mapped = all(
        isinstance(refusal, Exception) and refusal_for(refusal) is not None for refusal in refusals
    )
    return refusals[0] if refusals and every_one_mapped else None


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
        content=ErrorBody(
            code=code, message=str(error), details=_details_of(error, code)
        ).model_dump(exclude_none=True),
    )


def _details_of(error: Exception, code: str) -> dict[str, Any] | None:
    """What the refusal is about, in fields a client can word without parsing the sentence.

    One convention for any domain error: an optional `details` mapping, passed through as it is
    (PL-006, PL-007), which `WeightsAllLockedError` follows too -- its reason and the locks in
    the way, which the screen names (`reqs.md` 5.2, PL-112). A message a user cannot act on is
    barely better than none.

    **A refusal naming request fields lists them as a 422 does** (PL-026): `details.errors`,
    one `FieldProblem` per field, of the refusal's own kind -- so a form marks a band the domain
    refused exactly as it marks a figure the boundary refused, with one mapper.
    """
    details = getattr(error, "details", None)
    rendered = dict(details) if isinstance(details, Mapping) else {}
    fields = getattr(error, "fields", ())
    if fields:
        rendered["errors"] = [_domain_field_problem(error, field, code) for field in fields]
    return rendered or None


def _domain_field_problem(error: Exception, field: str, code: str) -> dict[str, Any]:
    problem: dict[str, Any] = {"location": ["body", field], "problem": str(error), "kind": code}
    limit = getattr(error, "limit", None)
    if _is_a_number(limit):
        problem["limit"] = float(limit)
    return problem


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


async def request_validation_handler(request: Request, error: Exception) -> JSONResponse:
    """A request the boundary rejects, in the one error shape.

    FastAPI renders a `RequestValidationError` as `{"detail": [...]}` -- the same shape mismatch
    `refusal_handler` closes for `HTTPException`. `arch.md` 7.6 gives this API one error shape, so
    a malformed body or an out-of-range field answers with `code`/`message` like any other
    refusal. **This is where bad input is meant to land**: the request bodies carry the domain's
    own bounds, so a value the domain would reject is a 422 raised here, before the endpoint runs
    -- never a `ValidationError` escaping domain construction into a 500. The offending fields
    travel in `details` so a form can still point at them.
    """
    assert isinstance(error, RequestValidationError)
    return JSONResponse(
        status_code=422,
        content=ErrorBody(
            code="invalid_request",
            message="The request does not match what this operation accepts.",
            details={"errors": _validation_details(error)},
        ).model_dump(exclude_none=True),
    )


_NUMERIC_BOUNDS = ("le", "ge", "lt", "gt")
"""The `ctx` keys that hold the bound a value fell outside, in the contract's `FieldProblem`."""


def _validation_details(error: RequestValidationError) -> list[dict[str, Any]]:
    """Each offending field as the contract's `FieldProblem`: where, what kind, and the limit.

    A form words its refusal from `kind` and `limit` (PL-028), so neither is left in the
    sentence. **Never the whole `ctx`**: it can hold the original exception object or a `date`,
    neither of which serialises, so only a numeric bound is taken from it.
    """
    return [_field_problem(item) for item in error.errors()]


def _field_problem(item: Mapping[str, Any]) -> dict[str, Any]:
    context = item.get("ctx") or {}
    problem = {
        "location": _location_as_the_contract_names_it(item.get("loc", ())),
        "problem": item.get("msg", ""),
        "kind": _kind_of(item["type"], context),
    }
    bounds = [context[key] for key in _NUMERIC_BOUNDS if _is_a_number(context.get(key))]
    if bounds:
        problem["limit"] = float(bounds[0])
    return problem


def _location_as_the_contract_names_it(location: Iterable[object]) -> list[str]:
    """`[path, criteriaSetId]` rather than FastAPI's `[path, criteria_set_id]`.

    A route names a path parameter in Python's case and the contract in its own, and a client
    reads the contract; a body field and a query parameter are already named alike.
    """
    parts = [str(part) for part in location]
    if len(parts) > 1 and parts[0] == "path":
        head, *rest = parts[1].split("_")
        parts[1] = head + "".join(word.capitalize() for word in rest)
    return parts


def _kind_of(validator_kind: str, context: Mapping[str, Any]) -> str:
    """The validator's kind, except that an identifier that cannot be one says so.

    Pydantic calls every refusal a validator raises `value_error`; a malformed identifier is the
    one a client words on its own (`arch.md` 7.3), so it gets a kind of its own.
    """
    if isinstance(context.get("error"), MalformedIdentifierError):
        return "malformed_identifier"
    return validator_kind


def _is_a_number(bound: object) -> bool:
    return isinstance(bound, int | float | Decimal) and not isinstance(bound, bool)


async def refuse_unknown_query_parameters(request: Request) -> None:
    """Refuse a query parameter the operation does not declare, rather than ignore it (BE-23).

    FastAPI drops one silently: a misspelled parameter answered as though it had not been sent,
    `dry_run=true` started a real run, and a filter the server does not apply returned
    everything unfiltered.
    Every unknown name is listed at once, located in the query, and answered as any other
    malformed request is: 422 `invalid_request`, by `request_validation_handler`.

    **Declared means declared anywhere the operation reads from**, the sub-dependencies
    included, and by the name a client sends -- an alias, where one is set.
    """
    route: APIRoute = request.scope["route"]
    declared = _query_parameters_of(route.dependant)
    unknown = [name for name in request.query_params if name not in declared]
    if unknown:
        raise RequestValidationError(
            [
                {
                    "type": "extra_forbidden",
                    "loc": ("query", name),
                    "msg": "Extra inputs are not permitted",
                    "input": request.query_params.get(name),
                }
                for name in unknown
            ]
        )


def _query_parameters_of(dependant: Dependant) -> set[str]:
    """Every query name an operation reads, under the name FastAPI itself reads it by."""
    return {get_validation_alias(parameter) for parameter in dependant.query_params}.union(
        *(_query_parameters_of(sub) for sub in dependant.dependencies)
    )
