"""One real question to Anthropic. **This spends money**, and only `make live-llm` runs it.

**What it proves is the one thing a stub cannot**: that the SDK still returns the shape
`client.py` reads. Every other LLM test in this repository uses recorded shapes, which is the
right trade -- the gate must cost nothing and never flake -- but it leaves exactly one risk, and
this is the thing that retires it.

It asks the smallest useful question and asserts the shape rather than the answer: what a page
says about a visa route is not this suite's business, and pinning it would make the test fail for
being right about a different week.
"""

import os
from decimal import Decimal

import pytest

from starnest.data_sources.llm import LlmPricing, LlmWithSearch

pytestmark = pytest.mark.live_llm


@pytest.fixture
def a_real_model() -> LlmWithSearch:
    """The real SDK, priced from the environment, or a skip that says what is missing."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        pytest.skip("ANTHROPIC_API_KEY is not set, so there is nothing to ask")

    prices = {
        name: os.environ.get(name)
        for name in ("LLM_INPUT_EUR_PER_MTOK", "LLM_OUTPUT_EUR_PER_MTOK", "LLM_EUR_PER_WEB_SEARCH")
    }
    if not all(prices.values()):
        pytest.skip(f"prices are not configured: {prices}")

    from anthropic import AsyncAnthropic

    return LlmWithSearch(
        AsyncAnthropic(api_key=key).messages,
        model=os.environ.get("LLM_MODEL", "claude-sonnet-5"),
        pricing=LlmPricing(
            input_eur_per_million_tokens=Decimal(str(prices["LLM_INPUT_EUR_PER_MTOK"])),
            output_eur_per_million_tokens=Decimal(str(prices["LLM_OUTPUT_EUR_PER_MTOK"])),
            eur_per_web_search=Decimal(str(prices["LLM_EUR_PER_WEB_SEARCH"])),
        ),
        max_searches=2,
        max_tokens=512,
    )


async def test_the_shape_the_client_reads_is_the_shape_that_arrives(
    a_real_model: LlmWithSearch,
) -> None:
    """Prose, the pages it read, and a cost above zero -- which together are everything the
    three uses rest on. A shape change shows up here as an empty citation tuple or a zero cost,
    both of which would silently weaken the stubbed tests."""
    answered = await a_real_model.ask(
        "Reply with one JSON object and nothing else, after searching: "
        '{"country": "Portugal", "capital": "<the capital city>"}'
    )

    assert answered.text.strip()
    assert answered.is_grounded, "no citations came back, so the client would refuse every value"
    assert answered.cost_eur > Decimal(0)
    assert answered.web_searches >= 1
