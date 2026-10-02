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
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import Attribute, Value, ValueStore
from starnest.data_acquisition.adapter import AcquisitionFailure, SourceAdapter
from starnest.data_acquisition.spend import CostMeter


@dataclass(frozen=True)
class RunOutcome:
    """What one run did, in the two numbers worth reporting and the reasons behind them."""

    stored: tuple[Value, ...]
    failures: tuple[AcquisitionFailure, ...]
    cost_eur: Decimal = Decimal(0)
    calls: int = 0

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
    meter: CostMeter | None = None,
    collecting: list[AcquisitionFailure] | None = None,
) -> RunOutcome:
    """Fetch every attribute this source can answer, and append what it found.

    **Only the attributes the adapter declares.** Asking a source for something it does not
    publish would come back as a failure per attribute and bury the failures that mean
    something, so the filter happens here rather than in each adapter.

    **The figures are appended per attribute**, as each answer arrives, because a run that dies
    halfway must keep what it already has (`arch.md` 7.1). Appending once at the end read more
    tidily and lost a whole source's work to one exception.

    **The meter stops the sweep between attributes** (P47). Given one, this records what each
    answer cost and asks nothing further once the cap is reached. Without it the cap was read
    only after this whole call returned, so a source answering three uncovered attributes over
    32 countries spent close to five times a 1 EUR cap and *then* reported the run halted -- a
    receipt rather than a ceiling. `None` is every source shipped today: all of them are free,
    and a meter would have nothing to measure.
    """
    answerable = [attribute for attribute in attributes if attribute.id in adapter.attributes]

    stored: list[Value] = []
    failures: list[AcquisitionFailure] = []
    cost, calls = Decimal(0), 0

    # **Stored per attribute, not once at the end** (`arch.md` 7.1). The first version fetched
    # every attribute this source could answer and appended the lot afterwards, which made a
    # process dying mid-source lose every figure it had already fetched -- found by Gate D's
    # first failure mode, which exists to ask exactly this. One append per attribute keeps the
    # loss window to the attribute in flight.
    # **A paid source gets the meter, and then does its own accounting** (P91). The check below
    # runs between attributes, and for a source billing per candidate one attribute is 32
    # calls -- all of them committed before anything here looks at the meter. A source holding
    # the meter records each call as it makes it and stops when the cap is reached, so the
    # overrun is one call rather than a whole sweep. Only a source that says it charges is
    # given it, so the free adapters are never handed a hook they cannot use.
    if meter is not None and adapter.costs_money:
        adapter.meter_with(meter)

    for attribute in answerable:
        spent_before = meter.spent_eur if meter is not None else Decimal(0)
        calls_before = meter.calls if meter is not None else 0
        acquired = await adapter.fetch(attribute, candidates)
        cost += acquired.cost_eur
        calls += acquired.calls
        # Recorded before the append, because the call is already billed whatever happens to
        # the figures it returned.
        #
        # **Whatever the source did not record itself.** A paid source holding the meter
        # records each call as it makes it, so adding its total again would charge the run
        # twice. Taking the difference covers both: a source that recorded everything adds
        # nothing here, and one that declares `costs_money` and then ignores the meter is
        # accounted for in full -- so the cap is never weaker than it was before the hook
        # existed, which is a guarantee that must not rest on an adapter's good behaviour.
        if meter is not None:
            unrecorded_cost = acquired.cost_eur - (meter.spent_eur - spent_before)
            unrecorded_calls = acquired.calls - (meter.calls - calls_before)
            if unrecorded_cost > 0 or unrecorded_calls > 0:
                meter.spent(
                    cost_eur=max(unrecorded_cost, Decimal(0)),
                    calls=max(unrecorded_calls, 0),
                )

        # Every value carries the run that fetched it (`reqs.md` 3.8), stamped here rather than
        # by each adapter: which occasion a figure came from is a fact about the run, and an
        # adapter that had to be told its own run id could forget.
        fetched = (
            acquired.values
            if run is None
            else tuple(
                value.model_copy(update={"data_acquisition_run": run}) for value in acquired.values
            )
        )
        if fetched:
            stored.extend(await values.append(fetched))
        # Which source failed, stamped for the same reason as the run above: two sources answer
        # the total tax rate, and a retry has to know which one to ask again.
        #
        # **Handed to the caller as they happen, not only in the return value** (P66). The
        # comment above explains why figures are appended per attribute rather than once at the
        # end -- a process dying mid-source would lose the lot. Failures are the other half of
        # what a run produces and were returned only on the way out, so the same death lost
        # every one of them and the run was recorded as having failed on nothing. `collecting`
        # is the caller's own list, so what is known survives an exception from the next
        # `fetch`.
        stamped = [
            replace(failure, data_source=adapter.data_source) for failure in acquired.failures
        ]
        failures.extend(stamped)
        if collecting is not None:
            collecting.extend(stamped)

        # After this answer is stored, never before it: the cap stops the *next* call, and
        # what has already been paid for is kept. The run one level up sees the exhausted meter
        # and halts, so the attributes left unasked are reported as unanswered rather than
        # silently dropped.
        if meter is not None and meter.is_exhausted:
            break

    return RunOutcome(
        stored=tuple(stored),
        failures=tuple(failures),
        cost_eur=cost,
        calls=calls,
    )
