"""Running one acquisition and recording it: the lifecycle around `acquire`.

`acquire` fetches and stores; this opens the run before anything is fetched, stamps every value
with it, records what failed, and closes it. Separated because the two answer different
questions -- what a source has, and what happened on this occasion -- and only the second needs
a store to write to.

**The run is opened first, and that ordering is the point.** A run written only on success would
leave nothing behind when the process dies mid-flight, and an abandoned run is exactly what
`arch.md` 9.2's startup sweep looks for. A run that exists and never finished is a fact; a run
that was never written is a gap nobody can see.

**Every value carries the run that fetched it** (`reqs.md` 3.8). That is what lets a figure on
screen say which pass produced it, and what makes "re-run just this" answerable later.
"""

from collections.abc import Sequence
from datetime import UTC, datetime

from starnest.candidates import Candidate
from starnest.data import Attribute, ValueStore
from starnest.data_acquisition.adapter import SourceAdapter
from starnest.data_acquisition.run import acquire
from starnest.data_acquisition.store import Run, RunScope, RunStatus, RunStore

MANUAL = "user"
"""Who asked for it. One user running locally, so there is one answer until something else
starts runs (`reqs.md` 10)."""


async def execute_run(
    *,
    adapter: SourceAdapter,
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    runs: RunStore,
    level: str,
    triggered_by: str = MANUAL,
) -> Run:
    """Open a run, fetch everything in scope, record what happened, close it.

    **The scope recorded is what was asked for, not what worked.** Every candidate and every
    attribute the adapter could answer goes in, so a country that produced nothing is
    distinguishable afterwards from one nobody asked about -- which is the difference selective
    retry turns on.

    The run is closed `completed` even when items failed. A run completes for everything that
    works and reports the rest (`reqs.md` 6.4); `failed` is for a run that could not proceed at
    all, and treating a sparse indicator as a failed run would mean never completing one.
    """
    answerable = [attribute for attribute in attributes if attribute.id in adapter.attributes]
    scope = RunScope(
        level=level,
        candidates=tuple(str(candidate.id) for candidate in candidates),
        attributes=tuple(str(attribute.id) for attribute in answerable),
    )
    run = await runs.start_run(scope, triggered_by=triggered_by)

    try:
        outcome = await acquire(
            adapter=adapter,
            attributes=answerable,
            candidates=candidates,
            values=values,
            run=run,
        )
    except Exception:
        # The run stays visible as one that could not proceed, rather than as one still
        # running for ever. Re-raised because an unexpected failure is a bug, and a tidy
        # record of it is not a reason to swallow it.
        await runs.finish_run(run, status=RunStatus.FAILED, finished_at=datetime.now(tz=UTC))
        raise

    await runs.record_failures(run, outcome.failures)
    await runs.finish_run(run, status=RunStatus.COMPLETED, finished_at=datetime.now(tz=UTC))
    return await runs.read_run(run)
