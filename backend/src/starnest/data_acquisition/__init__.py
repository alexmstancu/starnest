"""Running a fetch: the contract a source implements, and what one run produced.

`arch.md` 6.1. This module owns what acquiring a figure *is*; `data_sources/` owns how any
particular publisher answers. The interface is declared here and implemented there, so no
policy module ever names a concrete source -- `import-linter` contract 1 enforces it.

**Cut to one run** (`docs/mine2e.md` M2). The spend cap, the dry-run estimate and selective
retry are `reqs.md` 6.3 and 6.4 and are not here yet; what is here is enough to ask every source
for what it has across the candidates, keep what came back, and let a declared neighbour stand in
where nothing did.
"""

from starnest.data_acquisition.adapter import (
    Acquired,
    AcquisitionFailure,
    SourceAdapter,
)
from starnest.data_acquisition.declarations import declarations_that_disagree
from starnest.data_acquisition.execution import (
    NothingToAskAgainError,
    NothingToRetryError,
    ask_again,
    execute_run,
    retry_run,
)
from starnest.data_acquisition.run import RunOutcome, acquire
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
    "STAND_IN",
    "Acquired",
    "AcquisitionFailure",
    "NothingToAskAgainError",
    "NothingToRetryError",
    "Run",
    "RunOutcome",
    "RunScope",
    "RunStatus",
    "RunStore",
    "SourceAdapter",
    "UnansweredItem",
    "UnknownRunError",
    "acquire",
    "ask_again",
    "declarations_that_disagree",
    "execute_run",
    "figures_standing_in",
    "retry_run",
    "stand_in",
]
