"""One real question to Anthropic. **This spends money**, and only `make live-llm` runs it.

**What it proves is the one thing a stub cannot**: that the SDK still returns the shape
`client.py` reads. Every other LLM test in this repository uses recorded shapes, which is the
right trade -- the gate must cost nothing and never flake -- but it leaves exactly one risk, and
this is the thing that retires it.

It asks the smallest useful question and asserts the shape rather than the answer: what a page
says about a visa route is not this suite's business, and pinning it would make the test fail for
being right about a different week.

**It is configured through `Environment`**, the same loader the application uses, because it read
`os.environ` at first and therefore never ran at all -- the credentials live in `.env` (P34).

**It also prints what the call actually billed**, because `LLM_INPUT_TOKENS_PER_CALL` is the one
figure in the estimate that cannot be derived -- the provider injects the pages it searched into
the context, so the prompt's own length says little. Run this, read the line, set the variable
from a measurement rather than from a guess (`reqs.md` 6.3).
"""

from decimal import Decimal

import pytest

from starnest.data_sources.llm import LlmWithSearch

pytestmark = pytest.mark.live_llm


@pytest.fixture
def a_real_model() -> LlmWithSearch:
    """The real SDK, configured exactly as the application configures it.

    **Through `Environment`, not `os.environ`.** This test read the process environment for
    three days and therefore never ran: the key and the prices live in `.env`, which only
    pydantic-settings reads, so `make live-llm` skipped silently from any ordinary shell and the
    one check that proves the SDK still returns the shape `client.py` reads proved nothing
    (`known-issues.md` P34).

    Reading it the application's way is also the more honest test: what is under test is the
    configuration this machine would actually use, not a second copy of it assembled here.
    """
    from starnest.main import Environment, _the_model

    environment = Environment()  # type: ignore[call-arg]
    if not environment.anthropic_api_key:
        pytest.skip("ANTHROPIC_API_KEY is not configured, so there is nothing to ask")

    model = _the_model(environment)
    if model is None:
        pytest.skip("the llm path is not fully configured; the boot log names what is missing")

    assert isinstance(model, LlmWithSearch)
    # Two searches and a short answer: the smallest call that still exercises the whole shape.
    # Reassigned rather than passed, because the point is the *configured* model with a cheaper
    # ceiling, not a differently built one.
    model._max_searches = 2
    model._max_tokens = 512
    return model


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
