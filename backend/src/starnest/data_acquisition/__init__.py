"""Running a fetch: the contract a source implements, and what one run produced.

`arch.md` 6.1. This module owns what acquiring a figure *is*; `data_sources/` owns how any
particular publisher answers. The interface is declared here and implemented there, so no
policy module ever names a concrete source -- `import-linter` contract 1 enforces it.

**All of `reqs.md` 6.3 and 6.4 are here**: the dry-run estimate (`estimate.py`), the spend cap
and its halt (`spend.py`), selective retry over what failed and over what nobody answered
(`execution.py`), and the pass that asks every source for what it has, keeps what came back, and
lets a declared neighbour stand in where nothing did.
"""

from starnest.data_acquisition.adapter import (
    Acquired,
    AcquisitionFailure,
    SourceAdapter,
)
from starnest.data_acquisition.declarations import declarations_that_disagree
from starnest.data_acquisition.estimate import NOTHING, Estimate
from starnest.data_acquisition.execution import (
    NothingToAskAgainError,
    NothingToFetchError,
    NothingToRetryError,
    ask_again,
    asked_this_run,
    execute_run,
    retry_run,
)
from starnest.data_acquisition.research import (
    GateResearcher,
    NoResearcherConfiguredError,
    Researched,
    ResearchOutcome,
    gates_to_ask,
    plan_research,
    research_gates,
)
from starnest.data_acquisition.run import RunOutcome, acquire
from starnest.data_acquisition.spend import (
    CostMeter,
    SpendCapNotSetError,
    refuse_unless_capped,
)
from starnest.data_acquisition.stand_in import STAND_IN, figures_standing_in, stand_in
from starnest.data_acquisition.store import (
    Run,
    RunScope,
    RunStatus,
    RunStore,
    UnansweredItem,
    UnknownRunError,
)

__all__ = [
    "NOTHING",
    "STAND_IN",
    "Acquired",
    "AcquisitionFailure",
    "CostMeter",
    "Estimate",
    "GateResearcher",
    "NoResearcherConfiguredError",
    "NothingToAskAgainError",
    "NothingToFetchError",
    "NothingToRetryError",
    "ResearchOutcome",
    "Researched",
    "Run",
    "RunOutcome",
    "RunScope",
    "RunStatus",
    "RunStore",
    "SourceAdapter",
    "SpendCapNotSetError",
    "UnansweredItem",
    "UnknownRunError",
    "acquire",
    "ask_again",
    "asked_this_run",
    "declarations_that_disagree",
    "execute_run",
    "figures_standing_in",
    "gates_to_ask",
    "plan_research",
    "refuse_unless_capped",
    "research_gates",
    "retry_run",
    "stand_in",
]
