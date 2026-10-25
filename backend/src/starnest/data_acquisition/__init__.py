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
    RunningSpend,
    SourceAdapter,
)
from starnest.data_acquisition.declarations import declarations_that_disagree
from starnest.data_acquisition.estimate import NOTHING, Estimate
from starnest.data_acquisition.execution import (
    NothingToAskAgainError,
    NothingToFetchError,
    NothingToFetchReason,
    NothingToRetryError,
    OpenedRun,
    RunAlreadyInFlightError,
    SourcePlan,
    ask_again,
    asked_this_run,
    attributes_still_fresh,
    continue_run,
    execute_run,
    open_run,
    plan_sources,
    priced,
    retry_run,
    settle_scope,
    stand_ins_if_enabled,
    still_fresh_everywhere,
    switched_on,
)
from starnest.data_acquisition.holdings import Gap, Holdings, MonthlySpend
from starnest.data_acquisition.research import (
    GateResearcher,
    NoResearcherConfiguredError,
    NothingRecordedToRecheckError,
    Researched,
    ResearchLedger,
    ResearchOutcome,
    ResearchSpend,
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
    NotReachedItem,
    Reconfirmation,
    Run,
    RunPlan,
    RunScope,
    RunStatus,
    RunStore,
    SourceReach,
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
    "Gap",
    "GateResearcher",
    "Holdings",
    "MonthlySpend",
    "NoResearcherConfiguredError",
    "NotReachedItem",
    "NothingRecordedToRecheckError",
    "NothingToAskAgainError",
    "NothingToFetchError",
    "NothingToFetchReason",
    "NothingToRetryError",
    "OpenedRun",
    "Reconfirmation",
    "ResearchLedger",
    "ResearchOutcome",
    "ResearchSpend",
    "Researched",
    "Run",
    "RunAlreadyInFlightError",
    "RunOutcome",
    "RunPlan",
    "RunScope",
    "RunStatus",
    "RunStore",
    "RunningSpend",
    "SourceAdapter",
    "SourcePlan",
    "SourceReach",
    "SpendCapNotSetError",
    "UnansweredItem",
    "UnknownRunError",
    "acquire",
    "ask_again",
    "asked_this_run",
    "attributes_still_fresh",
    "continue_run",
    "declarations_that_disagree",
    "execute_run",
    "figures_standing_in",
    "gates_to_ask",
    "open_run",
    "plan_research",
    "plan_sources",
    "priced",
    "refuse_unless_capped",
    "research_gates",
    "retry_run",
    "settle_scope",
    "stand_in",
    "stand_ins_if_enabled",
    "still_fresh_everywhere",
    "switched_on",
]
