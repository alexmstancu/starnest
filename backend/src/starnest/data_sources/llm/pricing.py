"""What a call costs, in numbers nobody wrote in code.

**A run that cannot measure its own cost cannot be capped**, and a cap is the only thing
standing between a bad prompt and an unbounded bill (`reqs.md` 6.3). So pricing is required
configuration for the LLM path rather than something defaulted: a default of zero would report
every call as free and make the cap ornamental, and a default of a real price would be this
application inventing what Anthropic charges.

Prices are **technical configuration** -- they describe how to reach a service and what it costs,
not what a place is like -- so they live in the environment beside the API key (`arch.md` 7.5),
and change when Anthropic's do without a migration.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

A_MILLION = Decimal(1_000_000)


class PricingNotConfiguredError(RuntimeError):
    """The LLM path was asked for without prices. Refused rather than run blind."""


@dataclass(frozen=True)
class LlmPricing:
    """Anthropic's prices, as the household configured them.

    Per million tokens, which is how they are published -- converted here rather than in the
    environment, so what is in `.env` is what is on the pricing page.
    """

    input_eur_per_million_tokens: Decimal
    output_eur_per_million_tokens: Decimal
    eur_per_web_search: Decimal

    @classmethod
    def configured(
        cls,
        *,
        input_eur_per_million_tokens: Decimal | None,
        output_eur_per_million_tokens: Decimal | None,
        eur_per_web_search: Decimal | None,
    ) -> "LlmPricing":
        """The prices, or a refusal naming what is missing.

        Called by the composition root, which is the only place that reads the environment.
        """
        missing = [
            name
            for name, value in (
                ("LLM_INPUT_EUR_PER_MTOK", input_eur_per_million_tokens),
                ("LLM_OUTPUT_EUR_PER_MTOK", output_eur_per_million_tokens),
                ("LLM_EUR_PER_WEB_SEARCH", eur_per_web_search),
            )
            if value is None
        ]
        if missing:
            raise PricingNotConfiguredError(
                "the LLM path cannot run without knowing what it costs: "
                f"{', '.join(missing)} is unset. A run that cannot measure its own spend "
                "cannot be capped, and nothing here invents a price (reqs.md 6.3)."
            )
        # Every value is present: `missing` is empty, which the type checker cannot see through
        # a list comprehension, hence the explicit reads rather than an assertion.
        return cls(
            input_eur_per_million_tokens=Decimal(str(input_eur_per_million_tokens)),
            output_eur_per_million_tokens=Decimal(str(output_eur_per_million_tokens)),
            eur_per_web_search=Decimal(str(eur_per_web_search)),
        )

    def cost_of(self, *, input_tokens: int, output_tokens: int, web_searches: int) -> Decimal:
        """What one answer cost, to the cent.

        Rounded up at the half cent rather than down: a cap that under-counts is a cap that
        lets one more call through than the household allowed.
        """
        tokens = (
            Decimal(input_tokens) * self.input_eur_per_million_tokens
            + Decimal(output_tokens) * self.output_eur_per_million_tokens
        ) / A_MILLION
        searches = Decimal(web_searches) * self.eur_per_web_search
        return (tokens + searches).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
