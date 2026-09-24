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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from starnest.data import DataSourceId
from starnest.data_acquisition.adapter import AcquisitionFailure


class RunStatus(StrEnum):
    """The five states a run can be in, spelled as the schema spells them.

    **The three ways of not finishing are three different facts.** `halted_on_spend_cap` means
    the money ran out, `halted_by_user` means a person stopped it, and `failed` means it broke
    or its process died. Collapsing any two would make the history lie about why the figures
    stop where they do -- which is the question somebody has when they come back to a
    half-filled corpus.
    """

    RUNNING = "running"
    COMPLETED = "completed"
    HALTED_ON_SPEND_CAP = "halted_on_spend_cap"
    HALTED_BY_USER = "halted_by_user"
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
class UnansweredItem:
    """One candidate and one attribute a run asked about and nobody answered.

    **Not a failure.** Every source asked did answer; none of them had a row for that candidate
    -- Eurostat publishes the whole indicator and simply omits Liechtenstein. Calling that a
    failure would blame a source for not covering a country it never claimed to.

    **Derived, never stored.** It is the absence of a value row and of a failure row for a pair
    the scope names, so recording it separately would be a second account of an absence that
    could disagree with the first (`reqs.md` Q217).
    """

    candidate: str
    attribute: str


@dataclass(frozen=True)
class SourceReach:
    """How far one source got in one run.

    **The two counts do not sum to anything.** A source that failed on an item another source
    then answered contributes to both a failure here and a completed item in the run's totals,
    and both are true. Forcing them into one figure would have to pick which fact to drop.
    """

    data_source: DataSourceId
    items_stored: int
    items_failed: int


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
    # How big the pass was, without listing it. The scope is stored expanded, and a history row
    # wants its size rather than its contents.
    scope_candidates: int = 0
    scope_attributes: int = 0
    items_total: int = 0
    items_completed: int = 0
    # Items some source failed on and no source answered -- never `len(failures)`, which counts
    # each source's failure and so overlaps `items_completed` wherever a second source answered.
    items_failed: int = 0
    # Asked about, and neither answered nor failed: every source asked had nothing for that
    # candidate. `items_completed + items_failed + items_unanswered == items_total`, which is
    # the arithmetic that did not close before Q217.
    items_unanswered: int = 0
    failures: tuple[AcquisitionFailure, ...] = field(default=())
    unanswered: tuple[UnansweredItem, ...] = field(default=())
    # Source by source, for a run being read back. Empty on a history row, which reports the
    # pass's size rather than its makeup.
    by_source: tuple[SourceReach, ...] = field(default=())
    # When somebody asked it to stop. A run still `running` with this set is one that will stop
    # at its next item -- which is a different thing to tell a reader than "running".
    stop_requested_at: datetime | None = None


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
    async def request_stop(self, run: int) -> bool:
        """Ask a run to stop, and say whether there was a running one to ask.

        **Stored rather than held in memory.** The run is a row and the loop is a background
        task; an in-process flag would be invisible to the poll that reports the run's state,
        and would be lost entirely the moment anything ran in a second process.
        """

    @abstractmethod
    async def stop_was_requested(self, run: int) -> bool:
        """Whether somebody has asked this run to stop. Read between items, never mid-fetch."""

    @abstractmethod
    async def add_spend(self, run: int, *, calls: int, cost_eur: Decimal) -> None:
        """Accrue what a completed call cost (`reqs.md` 6.3).

        An increment rather than a write of the total, because two sources may be in flight and
        a read-modify-write would lose one of their costs.
        """

    @abstractmethod
    async def read_run(self, run: int) -> Run:
        """One run with its scope, progress, failures and unanswered items.

        Raises `UnknownRunError`.
        """

    @abstractmethod
    async def read_runs(self, *, limit: int = 20, offset: int = 0) -> tuple[Run, ...]:
        """Recent runs, newest first. Paginated: runs are one of the three lists that grow."""

    @abstractmethod
    async def count_runs(self) -> int:
        """How many runs there are, for the `total` beside a page."""

    @abstractmethod
    async def last_retrieved(
        self,
        *,
        level: str | None = None,
        candidates: Sequence[str] = (),
        attributes: Sequence[str] = (),
    ) -> Mapping[tuple[str, str], datetime]:
        """When each candidate and attribute was last **asked about**, whatever came of it.

        Read from every stored value rather than the active ones: the question is when we last
        asked, and a figure that lost the active-value comparison or failed validation was
        still an answer somebody paid for.
        """

    @abstractmethod
    async def run_in_flight(self) -> int | None:
        """The run that is currently going, if one is.

        **One run at a time** (P35). `reqs.md` 10 is one household on one machine, and
        `sweep_abandoned_runs` already relies on that: it turns whatever is still `running` at
        boot into `failed`, because a run in flight when nothing is running it is a run whose
        process died. This is the same rule enforced at the other end, before a second run can
        start beside the first.
        """

    @abstractmethod
    async def sweep_abandoned_runs(self, *, finished_at: datetime) -> tuple[int, ...]:
        """Mark every run still `running` as `failed`, and say which (`arch.md` 9.2 step 4).

        Called at startup, where "still running" can only mean a process that died: nothing
        else starts a run (`reqs.md` 10). The values such a run wrote are untouched and keep
        its id, which is what makes the difference between what was asked for and what arrived
        readable afterwards.
        """


class UnknownRunError(LookupError):
    """No run has that identifier."""
