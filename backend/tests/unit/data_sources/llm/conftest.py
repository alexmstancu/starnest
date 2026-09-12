"""A model that answers what the test tells it to, and never a network.

**Recorded shapes, not a live call.** The blocks below are the shape Anthropic's SDK returns --
prose with citations, plus the search results the hosted tool produced -- written as
dictionaries, which the client reads through one accessor that accepts either those or the SDK's
Pydantic objects. Whether the real shape still matches is the opt-in `make live-llm`'s question;
it is the only thing in this repository that spends money, and it is never part of `make check`.
"""

from decimal import Decimal
from typing import Any

import pytest

from starnest.data_sources.llm import LlmPricing, LlmWithSearch

A_PAGE = "https://example.gov/immigration/skilled-worker"
ANOTHER_PAGE = "https://example.gov/statistics/rent"


@pytest.fixture
def pricing() -> LlmPricing:
    """Prices that make the arithmetic easy to read: 1 EUR per million either way, 1 per search."""
    return LlmPricing(
        input_eur_per_million_tokens=Decimal(1),
        output_eur_per_million_tokens=Decimal(1),
        eur_per_web_search=Decimal("0.01"),
    )


def an_answer(
    text: str,
    *,
    pages: tuple[str, ...] = (A_PAGE,),
    input_tokens: int = 1_000,
    output_tokens: int = 500,
    searches: int | None = None,
) -> dict[str, Any]:
    """One reply in the SDK's shape: search results, then prose citing them."""
    blocks: list[dict[str, Any]] = []
    if pages:
        blocks.append(
            {
                "type": "web_search_tool_result",
                "content": [{"type": "web_search_result", "url": page} for page in pages],
            }
        )
    blocks.append(
        {
            "type": "text",
            "text": text,
            "citations": [{"type": "web_search_result_location", "url": page} for page in pages],
        }
    )
    usage: dict[str, Any] = {"input_tokens": input_tokens, "output_tokens": output_tokens}
    if searches is not None:
        usage["server_tool_use"] = {"web_search_requests": searches}
    return {"content": blocks, "usage": usage}


class StubMessages:
    """The one SDK method the client uses, answering from a queue and recording the requests."""

    def __init__(self, *answers: Any) -> None:
        self._answers = list(answers)
        self.asked: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Any:
        self.asked.append(request)
        answer = self._answers.pop(0) if self._answers else an_answer("{}")
        if isinstance(answer, Exception):
            raise answer
        return answer


def a_model(*answers: Any, pricing: LlmPricing | None = None) -> LlmWithSearch:
    return LlmWithSearch(
        StubMessages(*answers),
        model="a-model-under-test",
        pricing=pricing
        or LlmPricing(
            input_eur_per_million_tokens=Decimal(1),
            output_eur_per_million_tokens=Decimal(1),
            eur_per_web_search=Decimal("0.01"),
        ),
    )
