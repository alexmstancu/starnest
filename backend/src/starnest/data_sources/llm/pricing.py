"""What a call costs, in numbers nobody wrote in code.

**A run that cannot measure its own cost cannot be capped**, and a cap is the only thing
standing between a bad prompt and an unbounded bill (`reqs.md` 6.3). So pricing is required
configuration for the LLM path rather than something defaulted: a default of zero would report
every call as free and make the cap ornamental, and a default of a real price would be this
application inventing what Anthropic charges.

**Anthropic publishes in USD; this application works in euro.** So the prices are configured in
USD, exactly as the pricing page states them, and converted by a rate that is *also*
configuration -- which is the same rule `reqs.md` 5.5 applies to every monetary value: a
conversion names the rate that produced it. Two consequences worth stating:

- **What is in `.env` is what is on the page.** No mental arithmetic between reading a price and
  pasting it, and no silent drift when Anthropic changes one.
- **The rate is the ECB's daily reference rate**, quoted as the ECB quotes it: 1 EUR = *n* USD.
  Entering the reciprocal by hand would be one more place to get a decimal point wrong.

The rate is a setting rather than a fetch because this is a spend guard, not a stored
measurement: the cap exists to stop a runaway loop, and being within a percent of today's rate
is the whole requirement. A stored monetary *value* is a different matter and has `data/fx.py`.

Prices and the rate are **technical configuration** -- they describe what a service costs, not
what a place is like -- so they live in the environment beside the API key (`arch.md` 7.5).
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

A_MILLION = Decimal(1_000_000)


class PricingNotConfiguredError(RuntimeError):
    """The LLM path was asked for without prices or without a rate. Refused rather than run
    blind: either missing number would make the cap a decoration."""


@dataclass(frozen=True)
class LlmPricing:
    """Anthropic's prices in USD, and the rate that turns them into euro.

    Per million tokens, which is how they are published -- converted here rather than in the
    environment, so what is in `.env` is what is on the pricing page.
    """

    input_usd_per_million_tokens: Decimal
    output_usd_per_million_tokens: Decimal
    usd_per_web_search: Decimal
    eur_usd_rate: Decimal
    """How many US dollars one euro buys, as the ECB quotes it (`1 EUR = n USD`)."""

    @classmethod
    def configured(
        cls,
        *,
        input_usd_per_million_tokens: Decimal | None,
        output_usd_per_million_tokens: Decimal | None,
        usd_per_web_search: Decimal | None,
        eur_usd_rate: Decimal | None,
    ) -> "LlmPricing":
        """The prices and the rate, or a refusal naming what is missing.

        Called by the composition root, which is the only place that reads the environment.
        """
        missing = [
            name
            for name, value in (
                ("LLM_INPUT_USD_PER_MTOK", input_usd_per_million_tokens),
                ("LLM_OUTPUT_USD_PER_MTOK", output_usd_per_million_tokens),
                ("LLM_USD_PER_WEB_SEARCH", usd_per_web_search),
                ("EUR_USD_RATE", eur_usd_rate),
            )
            if value is None
        ]
        if missing:
            raise PricingNotConfiguredError(
                "the LLM path cannot run without knowing what it costs: "
                f"{', '.join(missing)} is unset. A run that cannot measure its own spend "
                "cannot be capped, and nothing here invents a price or a rate (reqs.md 6.3)."
            )
        if not eur_usd_rate or Decimal(str(eur_usd_rate)) <= 0:
            raise PricingNotConfiguredError(
                f"EUR_USD_RATE is {eur_usd_rate}, and a rate of zero or less converts nothing"
            )
        return cls(
            input_usd_per_million_tokens=Decimal(str(input_usd_per_million_tokens)),
            output_usd_per_million_tokens=Decimal(str(output_usd_per_million_tokens)),
            usd_per_web_search=Decimal(str(usd_per_web_search)),
            eur_usd_rate=Decimal(str(eur_usd_rate)),
        )

    def cost_of(self, *, input_tokens: int, output_tokens: int, web_searches: int) -> Decimal:
        """What one answer cost, in euro, to the hundredth of a cent.

        **Search results are billed as input tokens**, which the pricing page states and which
        matters more than it looks: a call that reads three pages sends tens of thousands of
        input tokens rather than the few hundred of the prompt. `input_tokens` is whatever the
        provider reported, so that is already counted rather than estimated.

        Rounded up at the half rather than down: a cap that under-counts is a cap that lets one
        more call through than the household allowed.
        """
        tokens_usd = (
            Decimal(input_tokens) * self.input_usd_per_million_tokens
            + Decimal(output_tokens) * self.output_usd_per_million_tokens
        ) / A_MILLION
        searches_usd = Decimal(web_searches) * self.usd_per_web_search
        return ((tokens_usd + searches_usd) / self.eur_usd_rate).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )

    def describe(self) -> str:
        """One line for the boot log, so the rate a spend was measured with is on the record."""
        return (
            f"${self.input_usd_per_million_tokens}/${self.output_usd_per_million_tokens} per MTok "
            f"and ${self.usd_per_web_search} per search, at 1 EUR = {self.eur_usd_rate} USD"
        )
