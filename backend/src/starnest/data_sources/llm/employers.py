"""Which international employers operate in a country (`reqs.md` 6.10 use 2, 7.1).

**Type, not volume.** The question is whether firms that hire foreigners, work in English and
handle relocation are present -- a country with 5,000 postings at local firms in the local
language is far less employable than one with 500 at international firms, and no count reveals
that. So the attribute is a `LabelSet` of named firms, which the catalog decides and this adapter
obeys. (`reqs.md` 6.10's own summary line called it an `AssignedScore`; the catalog table in 7.1
says `LabelSet` and the catalog wins, as it did for Q215.)

**Named firms are checkable and a score is not.** A list can be looked up; "7 out of 10" cannot,
and the household can strike a name it disagrees with. That is what makes an LLM answer
acceptable here at all -- and why an answer citing nothing is refused rather than stored at low
confidence. `low` confidence is the floor for an LLM value, not a licence to skip the sources.
"""

import json
import logging
from collections.abc import Sequence
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    DataSourceId,
    LabelSet,
    Measurements,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.llm.client import Answered, LlmUnavailableError, LlmWithSearch
from starnest.data_sources.llm.reading import a_json_object, the_period_now

LLM = DataSourceId("llm")
"""What the catalog calls this source (`0002`), ranked second-to-last in priority so any
published figure displaces it."""
INTERNATIONAL_EMPLOYERS = AttributeId("country.international_employers")

_log = logging.getLogger("starnest.llm")

PROMPT = """Name international employers that currently operate in {country} and that a \
foreign professional could realistically join: firms that hire non-nationals, work in English, \
and handle relocation or visa sponsorship.

Search for evidence before answering, and answer only from pages you have read. Judge presence \
and type, not volume -- a handful of genuinely international employers matters more than many \
local ones.

Reply with one JSON object and nothing else:
{{"employers": ["...", "..."], "note": "one sentence on what the evidence shows"}}

Name at most twelve, each a firm you found evidence for. If you found no evidence at all, reply \
{{"employers": [], "note": "why"}} rather than naming a firm from memory."""


class LlmEmployersAdapter(SourceAdapter):
    """One question per country, answered with names and the pages they came from."""

    def __init__(self, llm: LlmWithSearch) -> None:
        self._llm = llm

    @property
    def data_source(self) -> DataSourceId:
        return LLM

    @property
    def costs_money(self) -> bool:
        """The only source in this application that charges, which is why the cap exists."""
        return True

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (INTERNATIONAL_EMPLOYERS,)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if attribute.id != INTERNATIONAL_EMPLOYERS:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"this adapter answers only {INTERNATIONAL_EMPLOYERS}",
                    ),
                )
            )

        measuring = Measurements(
            attribute=attribute,
            data_source=LLM,
            retrieved=the_period_now().retrieved,
            # Every LLM value is `low`, whatever it says and however well it cited
            # (`reqs.md` 6.10). The sources are what a reader checks; the confidence is what
            # keeps it below every published figure in the priority order.
            confidence_level=ConfidenceLevel.LOW,
        )
        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        cost, calls, searches = Decimal(0), 0, 0

        # One question per country, because the answer is about one country: asking for thirty-two
        # at once would return a list nobody could attribute to a page.
        for candidate in candidates:
            try:
                answered = await self._llm.ask(PROMPT.format(country=candidate.name))
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
            searches += answered.web_searches

            outcome = _the_employers_named(answered, candidate, measuring)
            if isinstance(outcome, AcquisitionFailure):
                failures.append(outcome)
            else:
                values.append(outcome)

        return Acquired(values=tuple(values), failures=tuple(failures), cost_eur=cost, calls=calls)


def _the_employers_named(
    answered: Answered, candidate: Candidate, measuring: Measurements
) -> Value | AcquisitionFailure:
    """The names, if the answer carries any and read anything.

    Three ways it is refused rather than stored, and each is the same principle: a figure with
    nothing behind it is worse than a gap (`reqs.md` 5.3). No pages read, no names found, or
    an answer that is not the JSON object it was asked for.
    """

    def refused(reason: str) -> AcquisitionFailure:
        return AcquisitionFailure(
            attribute=measuring.attribute.id, candidate=str(candidate.id), reason=reason
        )

    if not answered.is_grounded:
        return refused(
            "the model answered without reading anything, and a list of employers with no "
            "sources is not a measurement"
        )
    try:
        reply = a_json_object(answered.text)
    except (json.JSONDecodeError, ValueError) as unreadable:
        return refused(f"the model's reply was not the JSON object it was asked for: {unreadable}")

    named = [str(name).strip() for name in reply.get("employers", []) if str(name).strip()]
    if not named:
        return refused(
            f"the model found no international employer it could cite for {candidate.name}: "
            f"{reply.get('note', 'no reason given')}"
        )

    period = the_period_now()
    return measuring.figure(
        candidate=candidate,
        # Deduplicated in order: `LabelSet` refuses a repeat, and a model listing a firm twice
        # is a worse reason to lose the whole answer than to lose the duplicate.
        payload=LabelSet(labels=tuple(dict.fromkeys(named))),
        period=period.period,
        quote=str(reply.get("note", ""))[:500] or None,
        citations=answered.citations,
    )
