"""One question to a model that searches, what it read, and what it cost."""

from decimal import Decimal

import pytest

from starnest.data_sources.llm import LlmPricing, LlmUnavailableError, PricingNotConfiguredError
from starnest.data_sources.llm.client import WEB_SEARCH_TOOL

from .conftest import A_PAGE, ANOTHER_PAGE, StubMessages, a_model, an_answer


class TestWhatItCosts:
    def test_tokens_and_searches_are_both_billed(self, pricing: LlmPricing) -> None:
        cost = pricing.cost_of(input_tokens=1_000_000, output_tokens=500_000, web_searches=3)

        assert cost == Decimal("1.5300")

    def test_a_free_answer_costs_nothing(self, pricing: LlmPricing) -> None:
        assert pricing.cost_of(input_tokens=0, output_tokens=0, web_searches=0) == Decimal(0)

    def test_it_rounds_up_at_the_half_cent(self, pricing: LlmPricing) -> None:
        """A cap that under-counts lets one more call through than the household allowed."""
        cost = pricing.cost_of(input_tokens=1, output_tokens=0, web_searches=0)

        assert cost == Decimal("0.0000")  # a single token is below the fourth decimal

    @pytest.mark.parametrize(
        "missing",
        [
            "input_usd_per_million_tokens",
            "output_usd_per_million_tokens",
            "usd_per_web_search",
            "eur_usd_rate",
        ],
    )
    def test_every_number_is_required_and_the_refusal_names_what_is_missing(
        self, missing: str
    ) -> None:
        """A run that cannot measure its own cost cannot be capped, and a default of zero would
        make the cap ornamental. **The rate counts as one of the numbers**: prices in dollars
        with no rate measure nothing this application can act on."""
        prices = dict.fromkeys(
            [
                "input_usd_per_million_tokens",
                "output_usd_per_million_tokens",
                "usd_per_web_search",
                "eur_usd_rate",
            ],
            Decimal(1),
        )
        prices[missing] = None

        with pytest.raises(PricingNotConfiguredError, match="cannot measure its own"):
            LlmPricing.configured(**prices)  # type: ignore[arg-type]

    def test_fully_configured_prices_are_accepted(self) -> None:
        """The control for the refusals above, with the figures from the pricing page for the
        model this application asks by default."""
        configured = LlmPricing.configured(
            input_usd_per_million_tokens=Decimal(2),
            output_usd_per_million_tokens=Decimal(10),
            usd_per_web_search=Decimal("0.01"),
            eur_usd_rate=Decimal("1.1592"),
        )

        assert configured.output_usd_per_million_tokens == Decimal(10)

    @pytest.mark.parametrize("rate", [Decimal(0), Decimal("-1.2")])
    def test_a_rate_that_converts_nothing_is_refused(self, rate: Decimal) -> None:
        """Zero divides by zero and a negative one turns every cost upside down."""
        with pytest.raises(PricingNotConfiguredError, match="converts nothing"):
            LlmPricing.configured(
                input_usd_per_million_tokens=Decimal(2),
                output_usd_per_million_tokens=Decimal(10),
                usd_per_web_search=Decimal("0.01"),
                eur_usd_rate=rate,
            )

    def test_the_cost_is_in_euro_at_the_configured_rate(self) -> None:
        """Anthropic bills in dollars and this application works in euro, so the conversion is
        the last thing that happens -- and the rate it used is on the boot log."""
        in_dollars = LlmPricing(
            input_usd_per_million_tokens=Decimal(2),
            output_usd_per_million_tokens=Decimal(10),
            usd_per_web_search=Decimal("0.01"),
            eur_usd_rate=Decimal(1),
        )
        in_euro = LlmPricing(
            input_usd_per_million_tokens=Decimal(2),
            output_usd_per_million_tokens=Decimal(10),
            usd_per_web_search=Decimal("0.01"),
            eur_usd_rate=Decimal(2),
        )

        asked = {"input_tokens": 1_000_000, "output_tokens": 0, "web_searches": 0}
        assert in_dollars.cost_of(**asked) == Decimal("2.0000")
        # Twice as many dollars to the euro, so half the euro cost.
        assert in_euro.cost_of(**asked) == Decimal("1.0000")

    def test_the_rate_it_converted_with_is_in_what_it_says_about_itself(self) -> None:
        """A spend measured with an unknown rate is a spend nobody can check."""
        described = LlmPricing(
            input_usd_per_million_tokens=Decimal(2),
            output_usd_per_million_tokens=Decimal(10),
            usd_per_web_search=Decimal("0.01"),
            eur_usd_rate=Decimal("1.1592"),
        ).describe()

        assert "1 EUR = 1.1592 USD" in described
        assert "$2/$10 per MTok" in described


class TestWhatItAsks:
    async def test_the_hosted_search_tool_is_offered(self) -> None:
        """Without the tool the model answers from memory, which is the one thing no permitted
        use allows (`reqs.md` 6.10)."""
        messages = StubMessages(an_answer("{}"))
        model = a_model()
        model._messages = messages

        await model.ask("anything")

        (tool,) = messages.asked[0]["tools"]
        assert tool["type"] == WEB_SEARCH_TOOL

    async def test_the_prompt_is_sent_as_the_user_turn(self) -> None:
        messages = StubMessages(an_answer("{}"))
        model = a_model()
        model._messages = messages

        await model.ask("what is the rent in Lisbon?")

        assert messages.asked[0]["messages"] == [
            {"role": "user", "content": "what is the rent in Lisbon?"}
        ]


class TestWhatItReports:
    async def test_the_prose_and_the_pages_it_read(self) -> None:
        answered = await a_model(
            an_answer("Lisbon rents are published monthly.", pages=(A_PAGE, ANOTHER_PAGE))
        ).ask("q")

        assert answered.text == "Lisbon rents are published monthly."
        assert answered.citations == (A_PAGE, ANOTHER_PAGE)
        assert answered.is_grounded

    async def test_an_answer_that_read_nothing_is_not_grounded(self) -> None:
        """The check every caller makes before storing anything: a figure whose provenance is
        "the model said so" is not a measurement."""
        answered = await a_model(an_answer("From memory, about 1200 EUR.", pages=())).ask("q")

        assert answered.citations == ()
        assert not answered.is_grounded

    async def test_a_page_read_but_not_cited_still_counts_as_read(self) -> None:
        """Taking only the prose citations would drop a page the model read and paraphrased."""
        answer = an_answer("No citation markers here.", pages=(A_PAGE,))
        answer["content"][1]["citations"] = []

        answered = await a_model(answer).ask("q")

        assert answered.citations == (A_PAGE,)

    async def test_the_same_page_read_twice_is_reported_once(self) -> None:
        answered = await a_model(an_answer("cited twice", pages=(A_PAGE, A_PAGE))).ask("q")

        assert answered.citations == (A_PAGE,)

    async def test_the_cost_comes_from_the_usage_the_provider_reported(
        self, pricing: LlmPricing
    ) -> None:
        answered = await a_model(
            an_answer("x", input_tokens=2_000_000, output_tokens=0, searches=2),
            pricing=pricing,
        ).ask("q")

        assert answered.cost_eur == Decimal("2.0200")
        assert answered.web_searches == 2

    async def test_searches_are_counted_from_the_blocks_when_usage_does_not_say(self) -> None:
        """A fixture recorded before that field existed still has the results in it."""
        answered = await a_model(an_answer("x", pages=(A_PAGE,), searches=None)).ask("q")

        assert answered.web_searches == 1


class TestWhatItRefuses:
    async def test_an_sdk_failure_becomes_one_exception(self) -> None:
        """Every way it can fail is the same fact to whoever reads a run's failures."""
        with pytest.raises(LlmUnavailableError, match="the provider is down"):
            await a_model(RuntimeError("the provider is down")).ask("q")

    async def test_an_answer_with_no_text_at_all_is_refused(self) -> None:
        with pytest.raises(LlmUnavailableError, match="no text"):
            await a_model({"content": [], "usage": {}}).ask("q")


class TestWhatOneCallWouldCost:
    """Pricing a call **before** making it, which is what a dry-run estimate is (`reqs.md` 6.3).

    **Two of the three figures are ceilings the client already imposes**: `max_tokens` caps the
    output and `max_searches` caps the searches, and both are sent with every request. The input
    side is the one thing that cannot be known in advance -- the provider injects the pages it
    searched into the context -- so it is configured and named rather than guessed.
    """

    def test_it_prices_the_ceilings_it_actually_sends(self) -> None:
        """At 1 USD per million tokens and 1 EUR = 1 USD: 10,000 input and a 1,000-token output
        ceiling is 0.011, plus two searches at a cent is 0.031."""
        model = a_model(input_tokens_per_call=10_000)
        model._max_tokens = 1_000
        model._max_searches = 2

        assert model.cost_of_a_call_at_most == Decimal("0.0310")

    def test_a_bigger_assumed_call_costs_more(self) -> None:
        """The guard against the figure being ignored: a test that only asserted one number
        would pass with the input side dropped from the arithmetic."""
        smaller = a_model(input_tokens_per_call=10_000).cost_of_a_call_at_most
        larger = a_model(input_tokens_per_call=100_000).cost_of_a_call_at_most

        assert larger > smaller

    def test_what_it_says_it_rests_on_names_every_assumption(self) -> None:
        """A cost with no stated assumptions can only be trusted, never judged."""
        described = a_model(input_tokens_per_call=12_345).a_call_described

        assert "12,345 input tokens per call" in described
        assert "make live-llm" in described
        assert "1,024 output tokens" in described
        assert "5 searches" in described
        # The prices and the rate travel too, because the same call shape costs differently
        # under a different price list.
        assert "per MTok" in described

    async def test_what_it_billed_is_reported_beside_what_it_assumed(self) -> None:
        """`make live-llm` prints both, which is how `LLM_INPUT_TOKENS_PER_CALL` gets set from a
        measurement rather than from somebody's guess."""
        answered = await a_model(an_answer("{}", input_tokens=4_321, output_tokens=99)).ask("q")

        assert answered.input_tokens == 4_321
        assert answered.output_tokens == 99
