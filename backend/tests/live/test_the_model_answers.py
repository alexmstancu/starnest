"""One real question to Anthropic. **This spends money**, and only `make live-llm` runs it.

**What it proves is the one thing a stub cannot**: that the SDK still returns the shape
`client.py` reads. Every other LLM test in this repository uses recorded shapes, which is the
right trade -- the gate must cost nothing and never flake -- but it leaves exactly one risk, and
this is the thing that retires it.

It asks the smallest useful question and asserts the shape rather than the answer: what a page
says about a visa route is not this suite's business, and pinning it would make the test fail for
being right about a different week.

**It also prints what the call actually billed**, because `LLM_INPUT_TOKENS_PER_CALL` is the one
figure in the estimate that cannot be derived -- the provider injects the pages it searched into
the context, so the prompt's own length says little. Run this, read the line, set the variable
from a measurement rather than from a guess (`reqs.md` 6.3).
"""

import os
from decimal import Decimal

import pytest

from starnest.data_sources.llm import LlmPricing, LlmWithSearch

pytestmark = pytest.mark.live_llm

PRICES = (
    "LLM_INPUT_USD_PER_MTOK",
    "LLM_OUTPUT_USD_PER_MTOK",
    "LLM_USD_PER_WEB_SEARCH",
    "EUR_USD_RATE",
)


@pytest.fixture
def a_real_model() -> LlmWithSearch:
    """The real SDK, priced from the environment, or a skip that says what is missing."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        pytest.skip("ANTHROPIC_API_KEY is not set, so there is nothing to ask")

    prices = {name: os.environ.get(name) for name in PRICES}
    if not all(prices.values()):
        pytest.skip(f"prices are not configured: {prices}")

    from anthropic import AsyncAnthropic

    return LlmWithSearch(
        AsyncAnthropic(api_key=key).messages,
        model=os.environ.get("LLM_MODEL", "claude-sonnet-5"),
        pricing=LlmPricing.configured(
            input_usd_per_million_tokens=Decimal(str(prices["LLM_INPUT_USD_PER_MTOK"])),
            output_usd_per_million_tokens=Decimal(str(prices["LLM_OUTPUT_USD_PER_MTOK"])),
            usd_per_web_search=Decimal(str(prices["LLM_USD_PER_WEB_SEARCH"])),
            eur_usd_rate=Decimal(str(prices["EUR_USD_RATE"])),
        ),
        # Whatever is configured, so the printed measurement is comparable with the estimate
        # this environment would actually produce. Absent, one token -- which makes the
        # printed ratio read as "the configured figure is N times too small".
        input_tokens_per_call=int(os.environ.get("LLM_INPUT_TOKENS_PER_CALL", 1)),
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


async def test_it_reports_what_one_call_billed_so_the_estimate_can_be_configured(
    a_real_model: LlmWithSearch, capsys: pytest.CaptureFixture[str]
) -> None:
    """**Measurement, not assertion.** It asks one realistic question -- the gate prompt's shape,
    which is the most expensive of the three uses -- and prints what came back beside what this
    environment would have estimated.

    There is nothing to assert about the number itself: the right value for
    `LLM_INPUT_TOKENS_PER_CALL` is whatever Anthropic billed, and a test asserting a token count
    would fail whenever the provider changed how much of a page it injects. So it asserts only
    that a cost arrived, and reports the rest.
    """
    answered = await a_real_model.ask(
        "Search the official pages and reply with one JSON object and nothing else: "
        '{"answer": "matching" | "not_matching" | "unknown", "reason": "one sentence"}. '
        "Question: may a Romanian citizen work in Portugal without a visa?"
    )

    estimated = a_real_model.cost_of_a_call_at_most
    with capsys.disabled():
        print(
            f"\n  one call billed {answered.cost_eur} EUR: "
            f"{answered.input_tokens:,} input tokens, {answered.output_tokens:,} output, "
            f"{answered.web_searches} search(es)."
            f"\n  this environment would estimate at most {estimated} EUR per call."
            f"\n  so LLM_INPUT_TOKENS_PER_CALL={answered.input_tokens} is this call, measured."
            f"\n  {a_real_model.a_call_described}"
        )

    assert answered.cost_eur > Decimal(0)
