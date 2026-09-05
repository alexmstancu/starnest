"""Running a fetch: the contract a source implements, and what one run produced.

`arch.md` 6.1. This module owns what acquiring a figure *is*; `data_sources/` owns how any
particular publisher answers. The interface is declared here and implemented there, so no
policy module ever names a concrete source -- `import-linter` contract 1 enforces it.

**Cut to one run** (`docs/mine2e.md` M2). The spend cap, the dry-run estimate and selective
retry are `reqs.md` 6.3 and 6.4 and are not here yet; what is here is enough to ask one source
for one attribute across the candidates and keep what came back.
"""

from starnest.data_acquisition.adapter import (
    Acquired,
    AcquisitionFailure,
    SourceAdapter,
)
from starnest.data_acquisition.run import RunOutcome, acquire

__all__ = ["Acquired", "AcquisitionFailure", "RunOutcome", "SourceAdapter", "acquire"]
