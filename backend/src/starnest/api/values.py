"""Stored values with their provenance, and a value typed by hand where that is permitted.

`reqs.md` 3.6 and 6.5. Every figure on screen carries its source, **both dates** -- the period it
describes and the moment it was fetched, never merged -- its confidence, and whether it is the
one being scored. By default only the active value per attribute comes back; asking for the
superseded ones returns everything, because nothing is ever discarded and the drill-down's job is
to show that.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.dependencies import Candidates, Catalog, Values
from starnest.candidates import CandidateId, UnknownCandidateError
from starnest.data import (
    MANUAL_ENTRY_DEFAULT_CONFIDENCE,
    BreakdownOptionId,
    ConfidenceLevel,
    Monetary,
    Payload,
    ReferencePeriod,
    Value,
    ValueListing,
    a_manual_value,
)

router = APIRouter(tags=["values"])


class ReferencePeriodBody(BaseModel):
    start: date
    end: date


class ValueBody(BaseModel):
    id: int
    candidate: str
    attribute: str
    breakdown_option: str | None = None
    value_type: str
    payload: dict[str, Any]
    data_source: str
    reference_period: ReferencePeriodBody
    retrieval_date: datetime
    confidence_level: str
    is_active: bool
    rejection_reason: str | None = None
    quote: str | None = None
    citations: tuple[str, ...] = ()
    data_acquisition_run: int | None = None


class ValuesBody(BaseModel):
    items: tuple[ValueBody, ...]
    total: int


class ManualValueBody(BaseModel):
    """`ManualValueInput`. The source is implicitly `manual` and cannot be set here."""

    candidate: str
    attribute: str
    payload: dict[str, Any]
    reference_period: ReferencePeriodBody
    retrieval_date: datetime
    breakdown_option: str | None = None
    confidence_level: ConfidenceLevel = MANUAL_ENTRY_DEFAULT_CONFIDENCE
    quote: str | None = None
    citations: tuple[str, ...] = ()


@router.get("/values", operation_id="listValues", response_model=ValuesBody)
async def list_values(
    values: Values,
    candidate: str | None = None,
    attribute: str | None = None,
    include_superseded: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> ValuesBody:
    """The active value per attribute, or every value when `include_superseded` is set."""
    listings = await values.read_values(
        candidate=candidate,
        attribute=attribute,
        include_superseded=include_superseded,
        limit=limit,
        offset=offset,
    )
    total = await values.count_values(
        candidate=candidate, attribute=attribute, include_superseded=include_superseded
    )
    return ValuesBody(items=tuple(_value_body(listing) for listing in listings), total=total)


@router.post(
    "/values/manual", operation_id="enterValueManually", status_code=201, response_model=ValueBody
)
async def enter_value_manually(
    body: ManualValueBody, values: Values, catalog: Catalog, candidates: Candidates
) -> ValueBody:
    """Refused with 409 `manual_entry_not_permitted` where the attribute does not allow it, and
    409 `invalid_value` where the value is not one the attribute can hold."""
    attribute = await catalog.read_attribute(body.attribute)
    if not any(
        str(known.id) == body.candidate
        for known in await candidates.read_candidates(level=str(attribute.level))
    ):
        raise UnknownCandidateError(
            f"there is no candidate {body.candidate!r} at {attribute.level}"
        )
    value = a_manual_value(
        attribute,
        candidate=CandidateId(body.candidate),
        payload=body.payload,
        reference_period=ReferencePeriod(
            start=body.reference_period.start, end=body.reference_period.end
        ),
        retrieval_date=body.retrieval_date,
        confidence_level=body.confidence_level,
        quote=body.quote,
        citations=body.citations,
        breakdown_option=BreakdownOptionId(body.breakdown_option)
        if body.breakdown_option
        else None,
    )
    (stored,) = await values.append([value])
    listing = next(
        found
        for found in await values.read_values(
            candidate=body.candidate, attribute=body.attribute, include_superseded=True
        )
        if found.value.id == stored.id
    )
    return _value_body(listing)


def _value_body(listing: ValueListing) -> ValueBody:
    value: Value = listing.value
    return ValueBody(
        id=value.id or 0,
        candidate=str(value.candidate),
        attribute=str(value.attribute),
        breakdown_option=str(value.breakdown_option) if value.breakdown_option else None,
        value_type=value.value_type.value,
        payload=_payload_body(value.payload),
        data_source=str(value.data_source),
        reference_period=ReferencePeriodBody(
            start=value.reference_period.start, end=value.reference_period.end
        ),
        retrieval_date=value.retrieval_date,
        confidence_level=value.confidence_level.value,
        is_active=listing.is_active,
        rejection_reason=value.rejection_reason,
        quote=value.quote,
        citations=value.citations,
        data_acquisition_run=value.data_acquisition_run,
    )


def _payload_body(payload: Payload | None) -> dict[str, Any]:
    """The payload as the contract shapes it: the type is on the value, not repeated inside.

    **A monetary payload's exchange rate is not served yet.** The contract describes it as the
    rate, its date and its publisher, and the payload carries the first two only; serving it
    without the publisher would be a number with half its provenance. No monetary value is
    stored today (`known-issues.md` P10).
    """
    if payload is None:
        return {}
    exclude = {"value_type"} | (
        {"fx_rate", "fx_rate_date"} if isinstance(payload, Monetary) else set()
    )
    return _as_numbers(payload.model_dump(exclude=exclude, exclude_none=True))


def _as_numbers(dumped: Any) -> Any:
    """Decimals as JSON numbers. Pydantic's JSON mode writes them as strings, which is lossless
    and exactly what the contract does not say: `magnitude` is a number."""
    if isinstance(dumped, Decimal):
        return float(dumped)
    if isinstance(dumped, dict):
        return {key: _as_numbers(item) for key, item in dumped.items()}
    if isinstance(dumped, list | tuple):
        return [_as_numbers(item) for item in dumped]
    if isinstance(dumped, StrEnum):
        return dumped.value
    return dumped
