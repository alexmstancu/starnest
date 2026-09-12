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
        ["input_eur_per_million_tokens", "output_eur_per_million_tokens", "eur_per_web_search"],
    )
    def test_prices_are_required_and_the_refusal_names_what_is_missing(self, missing: str) -> None:
        """A run that cannot measure its own cost cannot be capped, and a default of zero would
        make the cap ornamental."""
        prices = dict.fromkeys(
            [
                "input_eur_per_million_tokens",
                "output_eur_per_million_tokens",
                "eur_per_web_search",
            ],
            Decimal(1),
        )
        prices[missing] = None

        with pytest.raises(PricingNotConfiguredError, match="cannot measure its own"):
            LlmPricing.configured(**prices)  # type: ignore[arg-type]

    def test_fully_configured_prices_are_accepted(self) -> None:
        """The control for the refusals above."""
        configured = LlmPricing.configured(
            input_eur_per_million_tokens=Decimal(3),
            output_eur_per_million_tokens=Decimal(15),
            eur_per_web_search=Decimal("0.01"),
        )

        assert configured.output_eur_per_million_tokens == Decimal(15)


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
