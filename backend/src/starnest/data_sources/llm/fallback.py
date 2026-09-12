"""A figure for an attribute no dataset covers (`reqs.md` 6.10 use 1).

**The riskiest of the three permitted uses, and scoped accordingly.** A model-supplied number
sits in the same column as a measured one, so three rules hold it apart:

1. **It answers only attributes nobody else can.** The composition root passes the set, computed
   from the adapter registry -- "no dataset covers this" is literally "no adapter declares it",
   which cannot drift from the registry the way a hand-kept list would.
2. **It answers only types that carry a magnitude.** A Köppen zone or a paragraph of prose is
   not something to ask a model for a number about (`reqs.md` 3.3a).
3. **A figure with no pages behind it is refused**, not stored at low confidence. Low confidence
   is the floor for an LLM value, not a substitute for evidence.

And it is asked per candidate, because the question is about one place.
"""

import json
import logging
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation

from starnest.candidates import Candidate
from starnest.data import (
    AssignedScore,
    Assigner,
    Attribute,
    AttributeId,
    ConfidenceLevel,
    Count,
    DataSourceId,
    Index,
    Measurements,
    Monetary,
    Quantity,
    Ratio,
    Value,
    ValuePayload,
    ValueType,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, Estimate, SourceAdapter
from starnest.data_sources.llm.client import Answered, LlmUnavailableError, LlmWithSearch
from starnest.data_sources.llm.reading import a_json_object, the_period_now

LLM = DataSourceId("llm")

_log = logging.getLogger("starnest.llm")

ANSWERABLE = frozenset(
    {
        ValueType.MONETARY,
        ValueType.QUANTITY,
        ValueType.COUNT,
        ValueType.RATIO,
        ValueType.INDEX,
        ValueType.ASSIGNED_SCORE,
    }
)
"""The six types that carry a comparable figure (`evaluation/magnitudes.py`). The other four
are not things to ask a model for a number about."""

PROMPT = """What is {attribute} for {country}?

{description}

Search official statistics and published sources before answering, and answer only from pages \
you have read. Give the figure in {unit}, for the most recent period you found.

Reply with one JSON object and nothing else:
{{"value": <number>, "period": "<the year or period the figure describes>", \
"note": "one sentence naming the publisher and the period"}}

If you found no published figure you can cite, reply {{"value": null, "note": "why"}} rather \
than estimating one."""


class LlmFallbackAdapter(SourceAdapter):
    """The last source asked, for the attributes nothing else answers."""

    def __init__(self, llm: LlmWithSearch, *, answers: Sequence[AttributeId | str]) -> None:
        self._llm = llm
        self._answers = tuple(AttributeId(str(attribute)) for attribute in answers)

    @property
    def data_source(self) -> DataSourceId:
        return LLM

    @property
    def costs_money(self) -> bool:
        return True

    def estimate_for(self, items: int) -> Estimate:
        """One call per item: one question about one attribute for one country."""
        return Estimate(
            calls=items,
            cost_eur=items * self._llm.cost_of_a_call_at_most,
            basis=self._llm.a_call_described,
        )

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return self._answers

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if attribute.value_type not in ANSWERABLE:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"{attribute.value_type} carries no magnitude, so a model is not "
                        "asked for one (reqs.md 3.3a)",
                    ),
                )
            )

        measuring = Measurements(
            attribute=attribute,
            data_source=LLM,
            retrieved=the_period_now().retrieved,
            confidence_level=ConfidenceLevel.LOW,
        )
        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        cost, calls = Decimal(0), 0

        for candidate in candidates:
            try:
                answered = await self._llm.ask(
                    PROMPT.format(
                        attribute=attribute.name,
                        country=candidate.name,
                        description=attribute.description or "",
                        unit=_the_unit_of(attribute),
                    )
                )
            except LlmUnavailableError as unavailable:
                failures.append(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        candidate=str(candidate.id),
                        reason=str(unavailable),
                    )
                )
                continue
            cost += answered.cost_eur
            calls += answered.calls

            outcome = _the_figure_given(answered, candidate, measuring)
            if isinstance(outcome, AcquisitionFailure):
                failures.append(outcome)
            else:
                values.append(outcome)

        _log.info(
            "fallback for %s: %d answered, %d refused, %s EUR",
            attribute.id,
            len(values),
            len(failures),
            cost,
        )
        return Acquired(values=tuple(values), failures=tuple(failures), cost_eur=cost, calls=calls)


def _the_unit_of(attribute: Attribute) -> str:
    """What to ask for the figure in, in the catalog's own words.

    The unit is catalog data and is restated to the model rather than guessed by it: a figure
    in the wrong unit is the one kind of wrong answer that looks entirely reasonable.
    """
    if attribute.quantity_parameters is not None:
        return attribute.quantity_parameters.unit
    if attribute.ratio_parameters is not None:
        return f"percent of {attribute.ratio_parameters.basis}"
    if attribute.index_parameters is not None:
        bounds = attribute.index_parameters
        return f"the {bounds.provider} index, {bounds.scale_min} to {bounds.scale_max}"
    if attribute.value_type is ValueType.MONETARY:
        return "euro"
    # A `Count` carries its basis in the payload rather than in a parameter block, so the
    # catalog has nothing more specific to say than the type does.
    return f"the unit a {attribute.value_type} takes"


def _the_figure_given(
    answered: Answered, candidate: Candidate, measuring: Measurements
) -> Value | AcquisitionFailure:
    """The number, if the answer carries one and read something to get it."""

    def refused(reason: str) -> AcquisitionFailure:
        return AcquisitionFailure(
            attribute=measuring.attribute.id, candidate=str(candidate.id), reason=reason
        )

    if not answered.is_grounded:
        return refused(
            "the model answered without reading anything, and a figure with no source is not a "
            "measurement"
        )
    try:
        reply = a_json_object(answered.text)
    except (json.JSONDecodeError, ValueError) as unreadable:
        return refused(f"the model's reply was not the JSON object it was asked for: {unreadable}")

    given = reply.get("value")
    if given is None:
        return refused(f"the model found no citable figure: {reply.get('note', 'no reason given')}")
    try:
        figure = Decimal(str(given))
    except (InvalidOperation, TypeError):
        return refused(f"the model's value {given!r} is not a number")

    payload = _payload_for(measuring.attribute, figure)
    if payload is None:
        return refused(
            f"{measuring.attribute.value_type} needs parameters the catalog does not give "
            f"{measuring.attribute.id}, so the figure cannot be shaped"
        )

    return measuring.figure(
        candidate=candidate,
        payload=payload,
        period=the_period_now().period,
        quote=str(reply.get("note", ""))[:500] or None,
        citations=answered.citations,
    )


def _payload_for(attribute: Attribute, figure: Decimal) -> ValuePayload | None:
    """The figure, in the shape the catalog declares. `None` when the catalog does not say.

    Every parameter comes from the attribute rather than from the answer, which is what keeps
    adding an attribute a data change (`arch.md` 1.2) -- and stops a model deciding what unit
    its own number is in.
    """
    if attribute.value_type is ValueType.MONETARY:
        return Monetary.in_euro(figure)
    if attribute.value_type is ValueType.QUANTITY and attribute.quantity_parameters:
        return Quantity(magnitude=figure, unit=attribute.quantity_parameters.unit)
    if attribute.value_type is ValueType.COUNT:
        # `Count` names its own basis; the catalog declares no block for it, so the figure is
        # counted per country -- which is what a national figure is.
        return Count(count=int(figure), basis="per_country")
    if attribute.value_type is ValueType.RATIO and attribute.ratio_parameters:
        return Ratio(value=figure, basis=attribute.ratio_parameters.basis)
    if attribute.value_type is ValueType.INDEX and attribute.index_parameters:
        bounds = attribute.index_parameters
        return Index(
            value=figure,
            provider=bounds.provider,
            scale_min=bounds.scale_min,
            scale_max=bounds.scale_max,
        )
    if attribute.value_type is ValueType.ASSIGNED_SCORE:
        # Assigned by the model, which is exactly what the assigner field is for: a score
        # somebody decided rather than measured, with who decided it recorded.
        return AssignedScore(value=figure, assigner=Assigner.LLM)
    return None
