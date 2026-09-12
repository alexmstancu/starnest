"""The LLM path: three permitted uses, each priced, each required to show its sources.

`reqs.md` 6.10 is exhaustive and these are the three it permits at country level:

| Module | Use |
|---|---|
| `employers.py` | `country.international_employers` -- named firms, as a `LabelSet` |
| `fallback.py` | a figure for an attribute no dataset covers |
| `gates.py` | a gate's answer, **always a proposal until a human confirms it** |

**What they share is the protocol half** -- one question, the pages it read, and what it cost
(`client.py`, `pricing.py`) -- exactly as the structured sources share `transport.py`. What they
do not share is the prompt or the shape of the answer, because those are the interpretation.

**Nothing here runs without prices.** A run that cannot measure its own cost cannot be capped,
and a cap is the only thing between a bad prompt and an unbounded bill.
"""

from starnest.data_sources.llm.client import (
    Answered,
    LlmUnavailableError,
    LlmWithSearch,
)
from starnest.data_sources.llm.employers import LlmEmployersAdapter
from starnest.data_sources.llm.fallback import LlmFallbackAdapter
from starnest.data_sources.llm.gates import LlmGateResearcher
from starnest.data_sources.llm.pricing import LlmPricing, PricingNotConfiguredError

__all__ = [
    "Answered",
    "LlmEmployersAdapter",
    "LlmFallbackAdapter",
    "LlmGateResearcher",
    "LlmPricing",
    "LlmUnavailableError",
    "LlmWithSearch",
    "PricingNotConfiguredError",
]
