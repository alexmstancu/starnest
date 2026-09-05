"""The World Bank, for the governance attributes nothing else in Europe measures.

**WGI is an aggregate, and that is worth saying plainly.** Each estimate is an unobserved-
components model over dozens of expert surveys, so it sits closer to somebody's interpretation
than to a measurement -- the kind of figure `reqs.md` normally keeps out of scoring. It is here
because `reqs.md` 7.1 names World Bank WGI as the source for these three attributes, including
the scale, and because no comparable pan-European raw measure of rule of law exists to prefer
instead. The decision is recorded there rather than taken here.

Where it earns its place: WGI answers all 32 candidates, **including Liechtenstein and the
United Kingdom**, which Eurostat leaves unanswered.
"""

from starnest.data_sources.world_bank.adapter import WORLD_BANK, WorldBankAdapter
from starnest.data_sources.world_bank.manifest import (
    BASE_URL,
    INDICATORS,
    GovernanceIndicator,
)
from starnest.data_sources.world_bank.response import Reading, WorldBankError, readings

__all__ = [
    "BASE_URL",
    "INDICATORS",
    "WORLD_BANK",
    "GovernanceIndicator",
    "Reading",
    "WorldBankAdapter",
    "WorldBankError",
    "readings",
]
