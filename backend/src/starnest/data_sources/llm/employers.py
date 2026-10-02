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
from starnest.data_acquisition import (
    Acquired,
    AcquisitionFailure,
    Estimate,
    RunningSpend,
    SourceAdapter,
)
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
        # **No meter until a run gives it one.** A source used outside a run -- an estimate,
        # a test -- must not refuse to answer because of a cap it was never told about.
        self._meter: RunningSpend | None = None

    @property
    def data_source(self) -> DataSourceId:
        return LLM

    @property
    def costs_money(self) -> bool:
        """The only source in this application that charges, which is why the cap exists."""
        return True

    def estimate_for(self, items: int) -> Estimate:
        """One call per item, because an item is one country and this asks per country."""
        return Estimate(
            calls=items,
            cost_eur=items * self._llm.cost_of_a_call_at_most,
            basis=self._llm.a_call_described,
        )

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (INTERNATIONAL_EMPLOYERS,)

    def _record(self, cost_eur: Decimal, calls: int) -> None:
        """Tell the run's meter what this one call billed, as it bills it (P91).

        Without this the run learns the whole sweep's cost only when `fetch` returns, so the
        check above has nothing to see and the cap stops the *next* attribute after this one
        has been paid for in full.
        """
        if self._meter is not None and (cost_eur or calls):
            self._meter.spent(cost_eur=cost_eur, calls=calls)

    def meter_with(self, meter: RunningSpend) -> None:
        self._meter = meter

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
            # **Checked before the call, never after** (P91). A sweep of 32 countries is 32
            # billed calls, and the run above reads its meter only between attributes -- so
            # without this the cap stops the *next attribute* after this one has already been
            # paid for in full. The candidates not asked about are reported as unanswered,
            # which is what a retry works from.
            if self._meter is not None and self._meter.is_exhausted:
                failures.append(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        candidate=str(candidate.id),
                        reason="the run reached its spend cap before this candidate was asked",
                    )
                )
                continue
            try:
                answered = await self._llm.ask(PROMPT.format(country=candidate.name))
            except LlmUnavailableError as unavailable:
                # **What the attempt billed is kept** (P71). A provider that replied charges
                # for the reply whether or not we could use it, so dropping the cost here made
                # the spend cap unenforceable exactly when a model is misbehaving. Zero when
                # the call never reached the provider, which the exception states.
                cost += unavailable.cost_eur
                calls += unavailable.calls
                self._record(unavailable.cost_eur, unavailable.calls)
                failures.append(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        candidate=str(candidate.id),
                        reason=str(unavailable),
                    )
                )
                continue
            cost += answered.cost_eur
            self._record(answered.cost_eur, answered.calls)
            calls += answered.calls
            searches += answered.web_searches

            outcome = _the_employers_named(answered, candidate, measuring)
            if isinstance(outcome, AcquisitionFailure):
                failures.append(outcome)
            else:
                values.append(outcome)

        return Acquired(values=tuple(values), failures=tuple(failures), cost_eur=cost, calls=calls)


MOST_EMPLOYERS_WORTH_NAMING = 12
"""What the prompt asks for, as a number the code can hold it to."""


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

    # **A list, checked for being one** (P72). `reply` is whatever the model returned, and
    # `{"employers": "Google"}` is a shape it can produce -- iterating a string yields its
    # characters, so that stored a `LabelSet` of G, o, g, l, e with real citations attached to
    # it. A reply that is not the asked-for shape has not answered.
    listed = reply.get("employers", [])
    if not isinstance(listed, list):
        return refused(
            "the model replied with a single value where a list of employers was asked for: "
            f"{type(listed).__name__}"
        )

    named = [str(name).strip() for name in listed if str(name).strip()]
    # **The ceiling the prompt states, enforced** (`reqs.md` 6.10 asks for a bounded list).
    # A prompt is a request; a model that names forty is not refused outright, because the
    # first twelve are still a usable answer and the rest are the part nobody asked for.
    named = named[:MOST_EMPLOYERS_WORTH_NAMING]
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
