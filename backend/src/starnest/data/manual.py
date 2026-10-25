"""A value typed by hand: permitted only where the attribute declares it (`reqs.md` 6.5).

**Values come from sources; typing one is the exception.** An open manual-entry field is the
fastest route to the failure `reqs.md` 10 forbids -- a plausible number with no measurement
behind it, indistinguishable in the ranking from a real one. So an attribute must declare
`manual_entry`, and nothing here offers a way round it.

**Manual ranks last and stays** (`reqs.md` 6.6): a typed value is a placeholder for a source
that does not exist yet, superseded the moment one does -- and kept, as the estimate it was.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import ValidationError

from starnest.candidates import CandidateId
from starnest.data.attribute import Attribute
from starnest.data.confidence import MANUAL_ENTRY_DEFAULT_CONFIDENCE, ConfidenceLevel
from starnest.data.identifiers import BreakdownOptionId, DataSourceId
from starnest.data.measurements import Measurements
from starnest.data.payloads import payload_class_for
from starnest.data.reference_period import ReferencePeriod
from starnest.data.sources import DataSource
from starnest.data.value import Value

MANUAL = DataSourceId("manual")


class ManualEntryNotPermittedError(ValueError):
    """The attribute has not declared that a value may be typed for it."""


class ManualEntrySwitchedOffError(ValueError):
    """The `manual` source is switched off, so a figure typed now could not count (Q232)."""


class InvalidManualValueError(ValueError):
    """The typed value is not one the attribute can hold."""


def a_manual_value(
    attribute: Attribute,
    *,
    sources: Sequence[DataSource],
    candidate: CandidateId,
    payload: Mapping[str, Any],
    reference_period: ReferencePeriod,
    retrieval_date: datetime,
    confidence_level: ConfidenceLevel = MANUAL_ENTRY_DEFAULT_CONFIDENCE,
    quote: str | None = None,
    citations: Sequence[str] = (),
    breakdown_option: BreakdownOptionId | None = None,
) -> Value:
    """The value, shaped by the attribute's own type, under the `manual` source.

    The payload's shape follows from the attribute rather than from the request: a client
    cannot type a Ratio into a Quantity attribute by labelling it one.

    **Refusals come in a fixed order**: permission, retirement, the `manual` switch, then the
    payload. A catalog fact nobody can change outranks a switch somebody can flip, which
    outranks what was typed -- each refusal names the one remedy that applies first (PL-089).
    """
    if not attribute.manual_entry:
        raise ManualEntryNotPermittedError(
            f"{attribute.id} does not permit manual entry: its values come from sources, and a "
            "typed one would be a number with no measurement behind it"
        )
    if attribute.is_retired:
        raise InvalidManualValueError(f"{attribute.id} is retired and takes no new values")
    if _is_switched_off(sources):
        raise ManualEntrySwitchedOffError(
            "manual entry is switched off, and a switched-off source is left out of scoring, so "
            "a figure typed now could not count. Switch it on in Configure to type one."
        )
    try:
        shaped = payload_class_for(attribute.value_type).model_validate(
            {**payload, "value_type": attribute.value_type}
        )
        return Measurements(
            attribute=attribute,
            data_source=MANUAL,
            retrieved=retrieval_date,
            confidence_level=confidence_level,
        ).figure(
            candidate=candidate,
            payload=shaped,
            period=reference_period,
            quote=quote,
            citations=citations,
            breakdown_option=breakdown_option,
        )
    except ValidationError as refused:
        raise InvalidManualValueError(
            f"{attribute.id} is a {attribute.value_type.value}, and this is not one: "
            f"{_the_reason(refused)}"
        ) from None


def _is_switched_off(sources: Sequence[DataSource]) -> bool:
    return any(source.id == MANUAL and not source.is_enabled for source in sources)


def _the_reason(refused: ValidationError) -> str:
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    where = ".".join(str(part) for part in first.get("loc", ()))
    message = str(original) if original is not None else str(first.get("msg", refused))
    return f"{where}: {message}" if where else message
