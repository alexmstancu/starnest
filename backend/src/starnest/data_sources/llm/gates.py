"""A model reading the official pages about a gate (`reqs.md` 6.10 use 3).

**The one place where asking a model is the best available answer.** No dataset publishes
whether a visa route exists for a particular passport, whether the Swiss quota is open this
year, or whether two tech roles could plausibly be found in a city. The pages exist; nobody
publishes them as data.

**It proposes; it never decides.** Every answer here is stored as a proposal and rules nothing
out until a human writes it (`data_acquisition/research.py`), which is why the prompt asks for
the official page rather than a confident verdict -- what the household is being given is
something to check, not something to believe.
"""

import json
import logging
from collections.abc import Sequence

from starnest.candidates import Candidate
from starnest.data import MatchResult, MatchRule
from starnest.data_acquisition import GateResearcher, Researched
from starnest.data_sources.llm.client import LlmUnavailableError, LlmWithSearch
from starnest.data_sources.llm.reading import a_json_object

_log = logging.getLogger("starnest.llm")

PROMPT = """Question about immigration and work eligibility, for one country.

Gate: {rule}
Country: {country}
The household holds these citizenships: {citizenships}

Search the official government pages before answering, and answer only from pages you have \
read. Do not guess, and do not rely on what you remember -- rules change.

Reply with one JSON object and nothing else:
{{"answer": "matching" | "not_matching" | "unknown",
  "reason": "two sentences: what the official page says, and what it means for this household"}}

Use "matching" when the gate is satisfied for this household, "not_matching" when it is not, \
and "unknown" when the official pages do not settle it. "unknown" is a perfectly good answer \
and is better than a confident wrong one: a human will read your reason and your sources before \
anything is decided."""


class LlmGateResearcher(GateResearcher):
    """One question per gate per candidate, answered with the pages behind it."""

    def __init__(self, llm: LlmWithSearch) -> None:
        self._llm = llm

    async def research(
        self, *, rule: MatchRule, candidate: Candidate, citizenships: Sequence[str]
    ) -> Researched:
        """What the official pages say, or an honest `unknown`.

        A failure to reach the model, an unreadable reply and an answer that cited nothing all
        come back as `unknown` with the reason: the caller stores nothing it cannot show sources
        for, and a gate nobody could research is exactly what `unknown` means (`reqs.md` 3.7).
        """
        try:
            answered = await self._llm.ask(
                PROMPT.format(
                    rule=rule.name,
                    country=candidate.name,
                    citizenships=", ".join(citizenships) or "none recorded",
                )
            )
        except LlmUnavailableError as unavailable:
            return Researched(
                match_result=MatchResult.UNKNOWN,
                reason=f"the model could not be reached: {unavailable}",
                citations=(),
            )

        try:
            reply = a_json_object(answered.text)
        except (json.JSONDecodeError, ValueError) as unreadable:
            return Researched(
                match_result=MatchResult.UNKNOWN,
                reason=f"the model's reply could not be read: {unreadable}",
                citations=answered.citations,
                cost_eur=answered.cost_eur,
                calls=answered.calls,
            )

        return Researched(
            match_result=_the_answer_in(reply),
            reason=str(reply.get("reason", ""))[:1000],
            citations=answered.citations,
            cost_eur=answered.cost_eur,
            calls=answered.calls,
        )


def _the_answer_in(reply: dict[str, object]) -> MatchResult:
    """The three answers a gate takes, and `unknown` for anything else the model said.

    A model that answered "probably" has answered `unknown`, which is the honest reading: the
    vocabulary has three members and inventing a fourth reading of a fourth word would be this
    module deciding what the model meant.
    """
    said = str(reply.get("answer", "")).strip().lower()
    if said == MatchResult.MATCHING.value:
        return MatchResult.MATCHING
    if said == MatchResult.NOT_MATCHING.value:
        return MatchResult.NOT_MATCHING
    return MatchResult.UNKNOWN
