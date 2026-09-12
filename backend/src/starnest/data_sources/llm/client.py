"""One question to a model that can search the web, and what it read to answer.

`reqs.md` 6.10. **The obligation this module exists to meet is the citations.** Every permitted
LLM use requires storing the pages the model actually read -- a figure with no sources is exactly
the plausible number this application exists to avoid, and a model will always produce one.

**It knows nothing about attributes, candidates or values.** It asks, it reports what came back,
and it prices it. What to ask and what to do with the answer belongs to the adapters beside it,
for the same reason `response.py` belongs to each structured source: how a publisher answers is
its own business.

**The response shape is the SDK's and is read defensively.** Anthropic's blocks arrive as
Pydantic objects, and the same fields appear as dictionaries in recorded fixtures -- so every
read goes through one accessor that accepts either. The shape is verified by the opt-in live
test rather than assumed: `make live-llm` is the only thing in this repository that spends
money, and it is never part of `make check`.
"""

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from starnest.data_sources.llm.pricing import LlmPricing

_log = logging.getLogger("starnest.llm")

WEB_SEARCH_TOOL = "web_search_20250305"
"""The server-side tool Anthropic hosts. Named here because it is part of the request shape,
not a preference -- a different version is a different tool."""


class LlmUnavailableError(Exception):
    """The model did not answer, or answered with nothing usable.

    One exception for every way that can happen, carrying a sentence: a refusal, a timeout, an
    empty answer. They are the same fact to whoever reads a run's failures -- the source did not
    answer -- which is how the structured sources report the same thing (`transport.py`).
    """


@dataclass(frozen=True)
class Answered:
    """What one question produced: the prose, the pages behind it, and what it cost."""

    text: str
    citations: tuple[str, ...]
    cost_eur: Decimal
    calls: int = 1
    web_searches: int = 0

    @property
    def is_grounded(self) -> bool:
        """Whether it read anything at all.

        **An ungrounded answer is refused by every caller here.** The model would happily list
        employers from memory, and a figure whose provenance is "the model said so" is not a
        measurement (`reqs.md` 6.10).
        """
        return bool(self.citations)


class Messages(Protocol):
    """The one method this module uses from the SDK, declared so a test can supply it."""

    async def create(self, **request: Any) -> Any: ...


class LlmWithSearch:
    """The Anthropic SDK with its hosted web search, priced per answer."""

    def __init__(
        self,
        messages: Messages,
        *,
        model: str,
        pricing: LlmPricing,
        max_searches: int = 5,
        max_tokens: int = 1024,
    ) -> None:
        self._messages = messages
        self._model = model
        self._pricing = pricing
        self._max_searches = max_searches
        self._max_tokens = max_tokens

    async def ask(self, prompt: str) -> Answered:
        """One question, answered with the pages it rested on.

        Raises `LlmUnavailableError` for every failure, priced at whatever the provider
        charged: a call that failed halfway still cost money, and a cap that ignored that
        would be a cap nobody could rely on.
        """
        try:
            answer = await self._messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                tools=[
                    {
                        "type": WEB_SEARCH_TOOL,
                        "name": "web_search",
                        "max_uses": self._max_searches,
                    }
                ],
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as unavailable:  # the SDK's own errors, whatever it raises
            raise LlmUnavailableError(str(unavailable)) from unavailable

        text = _the_prose(answer)
        if not text.strip():
            raise LlmUnavailableError("the model answered with no text at all")

        searches = _web_searches(answer)
        cost = self._pricing.cost_of(
            input_tokens=_usage(answer, "input_tokens"),
            output_tokens=_usage(answer, "output_tokens"),
            web_searches=searches,
        )
        answered = Answered(
            text=text,
            citations=_pages_read(answer),
            cost_eur=cost,
            web_searches=searches,
        )
        _log.info(
            "asked %s: %d search(es), %d citation(s), %s EUR",
            self._model,
            searches,
            len(answered.citations),
            cost,
        )
        return answered


def _field(item: Any, name: str, default: Any = None) -> Any:
    """One read for both shapes: a Pydantic block from the SDK, or a dict from a fixture."""
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _blocks(answer: Any) -> list[Any]:
    return list(_field(answer, "content", []) or [])


def _the_prose(answer: Any) -> str:
    """Every text block, joined. A searching model interleaves prose with tool blocks."""
    return "\n".join(
        str(_field(block, "text", ""))
        for block in _blocks(answer)
        if _field(block, "type") == "text"
    )


def _pages_read(answer: Any) -> tuple[str, ...]:
    """Every URL the answer rests on, in the order it read them, without repeats.

    Two shapes carry them and both are read: the search results the tool returned, and the
    citations attached to the prose. Taking only the second would drop a page the model read
    and then paraphrased without citing, which is still a page it read.
    """
    found: list[str] = []

    def remember(url: Any) -> None:
        if isinstance(url, str) and url and url not in found:
            found.append(url)

    for block in _blocks(answer):
        kind = _field(block, "type")
        if kind == "web_search_tool_result":
            for result in _field(block, "content", []) or []:
                remember(_field(result, "url"))
        if kind == "text":
            for citation in _field(block, "citations", []) or []:
                remember(_field(citation, "url"))
    return tuple(found)


def _web_searches(answer: Any) -> int:
    """How many searches the provider billed for.

    Read from `usage.server_tool_use` where the SDK reports it, and counted from the blocks
    otherwise -- a fixture recorded before that field existed still has the results in it.
    """
    usage = _field(answer, "usage")
    server_tools = _field(usage, "server_tool_use") if usage is not None else None
    billed = _field(server_tools, "web_search_requests") if server_tools is not None else None
    if isinstance(billed, int):
        return billed
    return sum(1 for block in _blocks(answer) if _field(block, "type") == "web_search_tool_result")


def _usage(answer: Any, name: str) -> int:
    usage = _field(answer, "usage")
    tokens = _field(usage, name, 0) if usage is not None else 0
    return int(tokens or 0)
