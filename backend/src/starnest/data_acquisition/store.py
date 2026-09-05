"""The seam this module declares: somewhere to record what a run planned, did and failed at.

`arch.md` 6.3. A run is a **persisted object** (`reqs.md` 3.8, Q21): when it ran, what it
touched, what it cost, and what went wrong. Values link back to it, which is how a figure can
say which pass fetched it.

**The scope stored is the PLANNED scope, not the achieved one.** Deriving it from the values a
run wrote would lose exactly the information selective retry and the dry-run estimate need --
a candidate that produced nothing would be indistinguishable from one nobody asked about.

**Failures are rows, not a blob.** A run continues past a failure (`reqs.md` 6.4), and the
(candidate, attribute) pair is the unit a retry addresses.
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from starnest.data_acquisition.adapter import AcquisitionFailure


class RunStatus(StrEnum):
    """The four states a run can be in, spelled as the schema spells them."""

    RUNNING = "running"
    COMPLETED = "completed"
    HALTED_ON_SPEND_CAP = "halted_on_spend_cap"
    FAILED = "failed"


@dataclass(frozen=True)
class RunScope:
    """What a run was asked to cover.

    `None` means "everything at this level" rather than "nothing", which is the difference
    between a full sweep and a no-op. It is stored expanded -- the rows name every candidate and
    attribute -- because a scope recorded as "everything" would mean something different after
    the catalog grew.
    """

    level: str
    candidates: tuple[str, ...] | None = None
    attributes: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Run:
    """One pass, as it stands."""

    id: int
    status: RunStatus
    started_at: datetime
    triggered_by: str
    finished_at: datetime | None = None
    llm_call_count: int = 0
    cost_eur: Decimal = Decimal(0)
    scope: RunScope | None = None
    items_total: int = 0
    items_completed: int = 0
    failures: tuple[AcquisitionFailure, ...] = field(default=())


class RunStore(ABC):
    """Record a run, and read back what it did."""

    @abstractmethod
    async def start_run(self, scope: RunScope, *, triggered_by: str) -> int:
        """Open a run over an expanded scope, and return its id.

        Opened before anything is fetched, so a run that dies mid-flight is still visible as one
        that started and never finished -- which is what `arch.md` 9.2's abandoned-run sweep
        looks for.
        """

    @abstractmethod
    async def finish_run(self, run: int, *, status: RunStatus, finished_at: datetime) -> None:
        """Close a run, however it ended."""

    @abstractmethod
    async def record_failures(self, run: int, failures: Sequence[AcquisitionFailure]) -> None:
        """Attach what did not work, so a retry knows what to address."""

    @abstractmethod
    async def read_run(self, run: int) -> Run:
        """One run with its scope, progress and failures. Raises `UnknownRunError`."""

    @abstractmethod
    async def read_runs(self, *, limit: int = 20, offset: int = 0) -> tuple[Run, ...]:
        """Recent runs, newest first. Paginated: runs are one of the three lists that grow."""

    @abstractmethod
    async def count_runs(self) -> int:
        """How many runs there are, for the `total` beside a page."""


class UnknownRunError(LookupError):
    """No run has that identifier."""
