"""One acquisition run: ask a source for what it has, and keep what came back.

`reqs.md` 3.8. A run is one programmatic pass that fetches from sources and writes value rows.

**It completes for everything that works** (`reqs.md` 6.4). Sparse coverage makes routine
failure the norm -- a country that has not filed, an indicator withdrawn, an API that times out
-- so a run that aborted on the first problem would be a run that never finished. Failures are
collected and reported; the values that did arrive are stored.

**Cut to one pass** (`docs/mine2e.md` M2). The spend cap and the dry-run estimate (`reqs.md`
6.3) and selective retry (6.4) are not here. What is here is enough to fetch real figures once
and have them land with real provenance -- which is the only thing minE2E needs, and the only
thing that can be judged before any figure exists.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace

from starnest.candidates import Candidate
from starnest.data import Attribute, Value, ValueStore
from starnest.data_acquisition.adapter import Acquired, AcquisitionFailure, SourceAdapter


@dataclass(frozen=True)
class RunOutcome:
    """What one run did, in the two numbers worth reporting and the reasons behind them."""

    stored: tuple[Value, ...]
    failures: tuple[AcquisitionFailure, ...]

    @property
    def attempted(self) -> int:
        return len(self.stored) + len(self.failures)


async def acquire(
    *,
    adapter: SourceAdapter,
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    run: int | None = None,
) -> RunOutcome:
    """Fetch every attribute this source can answer, and append what it found.

    **Only the attributes the adapter declares.** Asking a source for something it does not
    publish would come back as a failure per attribute and bury the failures that mean
    something, so the filter happens here rather than in each adapter.

    The values are appended in one call at the end rather than per attribute: appending is
    append-only and per-item transactional (`arch.md` 7.1), and one call keeps the ordering of
    what was fetched in the ordering of what was stored.
    """
    answerable = [attribute for attribute in attributes if attribute.id in adapter.attributes]
    acquired = Acquired()
    for attribute in answerable:
        acquired = acquired + await adapter.fetch(attribute, candidates)

    # Every value carries the run that fetched it (`reqs.md` 3.8), stamped here rather than by
    # each adapter: which occasion a figure came from is a fact about the run, and an adapter
    # that had to be told its own run id could forget.
    fetched = (
        acquired.values
        if run is None
        else tuple(
            value.model_copy(update={"data_acquisition_run": run}) for value in acquired.values
        )
    )
    stored = await values.append(fetched) if fetched else ()
    # Which source failed, stamped for the same reason as the run above: two sources answer the
    # total tax rate, and a retry has to know which one to ask again.
    failures = tuple(
        replace(failure, data_source=adapter.data_source) for failure in acquired.failures
    )
    return RunOutcome(stored=tuple(stored), failures=failures)
