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

import logging
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import Attribute, Value, ValueStore, restates
from starnest.data_acquisition.adapter import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_acquisition.spend import CostMeter

_log = logging.getLogger("starnest.acquisition")


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
    record_spend: Callable[[int, Decimal], Awaitable[None]] | None = None,
    record_failures: Callable[[Sequence[AcquisitionFailure]], Awaitable[None]] | None = None,
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

    async def reconfirm(pairs: set[tuple[str, str]]) -> None:
        # **A pair the source answered that was already on record is re-confirmed, not
        # unanswered** (ST-09). A transcribed table re-read is the same observation, so its
        # append is a no-op and no new row carries this run -- but the source did answer.
        # Recorded so the run counts the pair completed rather than offering to ask again for a
        # figure that is there. Keyed on the pair: a new value for it means it was stored, so
        # only a pair its batch stored nothing new for is a reuse.
        if run is not None and pairs:
            await values.record_reuse(run, adapter.data_source, pairs)

    async def charge_the_crash(attribute: Attribute, settled: set[str], fault: Exception) -> None:
        # **The item in flight keeps a failure** (PL-047). An exception no adapter turned into
        # a failure used to leave the candidates it had not answered with no row at all, so they
        # read as unanswered -- "retrying changes nothing" -- about a source that crashed. Only
        # the exception's class is quoted (P1-11): its message can carry data or secrets.
        stamped = [
            AcquisitionFailure(
                attribute=attribute.id,
                candidate=str(candidate.id),
                reason=(
                    f"the source stopped with an unexpected error ({type(fault).__name__}) "
                    "before answering"
                ),
                data_source=adapter.data_source,
            )
            for candidate in adapter.candidates_asked_about(attribute, candidates)
            if str(candidate.id) not in settled
        ]
        failures.extend(stamped)
        if collecting is not None:
            collecting.extend(stamped)
        if record_failures is not None and stamped:
            # A second fault must not mask the first; the caller records `collecting` again.
            try:
                await record_failures(stamped)
            except Exception:
                _log.exception("could not record what %s crashed on", adapter.data_source)

    for attribute in answerable:
        # **One batch at a time, not the whole attribute at once** (BE-19). A structured source
        # yields its one indicator in a single batch; a paid source billing per candidate yields
        # each candidate as it lands, so the loss window of a process death is the one batch in
        # flight rather than every paid answer the source had already handed back. The meter is
        # read against its own last reading rather than a snapshot taken before the attribute, so
        # the difference stays per batch as the source records each call.
        last_spent = meter.spent_eur if meter is not None else Decimal(0)
        last_calls = meter.calls if meter is not None else 0
        settled: set[str] = set()
        batches = adapter.fetch_in_batches(attribute, candidates)
        while True:
            # **Around the source alone, never the stores** (PL-047): a database fault while
            # storing a batch is not the source's failure, and must not be recorded as one.
            try:
                acquired = await anext(batches)
            except StopAsyncIteration:
                break
            except Exception as fault:
                await charge_the_crash(attribute, settled, fault)
                raise
            settled |= _candidates_settled_by(acquired, candidates)
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
                unrecorded_cost = acquired.cost_eur - (meter.spent_eur - last_spent)
                unrecorded_calls = acquired.calls - (meter.calls - last_calls)
                if unrecorded_cost > 0 or unrecorded_calls > 0:
                    meter.spent(
                        cost_eur=max(unrecorded_cost, Decimal(0)),
                        calls=max(unrecorded_calls, 0),
                    )
                last_spent = meter.spent_eur
                last_calls = meter.calls

            # **The spend is made durable per batch, not once the source finishes** (BE-33). A
            # run's cost used to be written only after a source's whole sweep, so a death
            # mid-sweep kept the figures already stored (BE-19) but lost the record of what they
            # cost -- the provider billed it, and the run understated it. Persisted here as each
            # batch is billed, before the next call, so what dies owes nothing it had not
            # recorded. The sum across batches is the source's total, so nothing is counted twice.
            if record_spend is not None and (acquired.calls or acquired.cost_eur):
                await record_spend(acquired.calls, acquired.cost_eur)

            # Every value carries the run that fetched it (`reqs.md` 3.8), stamped here rather
            # than by each adapter: which occasion a figure came from is a fact about the run,
            # and an adapter that had to be told its own run id could forget.
            fetched = (
                acquired.values
                if run is None
                else tuple(
                    value.model_copy(update={"data_acquisition_run": run})
                    for value in acquired.values
                )
            )
            # **Accepted figures first, then the failures, then the rejected figures** (P93). A
            # rejection's failure -- the only row a retry reads -- used to commit after the figure
            # and its reuse row, so a kill between them kept the rejection, lost the failure, and
            # no retry ever reached the pair. Not every failure first: one that could not be
            # written would then cost a paid batch the figures it had already bought (BE-19). A
            # kill between the failures and the rejected figures leaves a failure with nothing
            # stored behind it, and a retry asks again -- the honest direction to be wrong in.
            #
            # **A re-read that contradicts the figure on record is neither stored nor re-confirmed**
            # (NEW-23). Its append would be a silent no-op on the natural key, and the run then
            # credited the source with re-confirming a figure it had just contradicted. It is set
            # aside here and reported with this batch's failures instead.
            contradicting = await _contradicting(fetched, values) if fetched else ()
            contradicted = _pairs_of(contradicting)
            kept = [value for value in fetched if value not in contradicting]
            accepted = tuple(value for value in kept if not value.is_rejected)
            rejected = tuple(value for value in kept if value.is_rejected)
            newly_accepted = await values.append(accepted) if accepted else ()
            stored.extend(newly_accepted)
            # A pair a rejected figure answered too is settled with the rejected ones below.
            await reconfirm(
                _pairs_of(accepted) - _pairs_of(rejected) - _pairs_of(newly_accepted) - contradicted
            )

            # Which source failed, stamped for the same reason as the run above: two sources
            # answer the total tax rate, and a retry has to know which one to ask again.
            #
            # **Handed to the caller as they happen, not only in the return value** (P66). A
            # process dying mid-source would otherwise lose every failure it had collected and
            # the run would be recorded as having failed on nothing. `collecting` is the caller's
            # own list, so what is known survives an exception from the next batch.
            stamped = [
                replace(failure, data_source=adapter.data_source) for failure in acquired.failures
            ]
            # **A figure stored and rejected is a failure as well** (BE-08, `reqs.md` 3.3a). It
            # is kept with its reason and never becomes active, and a failure is the only thing a
            # retry reads -- so without one, a run whose sole answer was 62 °C for an annual mean
            # reported failing on nothing. The pair still counts as completed: the source did
            # answer it.
            stamped.extend(
                AcquisitionFailure(
                    attribute=value.attribute,
                    candidate=str(value.candidate),
                    reason=f"the figure was stored and rejected: {value.rejection_reason}",
                    data_source=adapter.data_source,
                )
                for value in rejected
            )
            stamped.extend(
                AcquisitionFailure(
                    attribute=value.attribute,
                    candidate=str(value.candidate),
                    reason=_CONTRADICTION,
                    data_source=adapter.data_source,
                )
                for value in contradicting
            )
            failures.extend(stamped)
            if collecting is not None:
                collecting.extend(stamped)
            # **Made durable per batch, before the next fetch** (BE-19 remainder). `collecting` is
            # the caller's in-memory list and the run writes failures at its halts and its end, so
            # a *hard kill* -- which raises nothing the caller can catch -- lost every failure the
            # run had collected, and the swept run reported failing on nothing with nothing for a
            # retry to reach. Persisted here as each batch is stamped, the failures of what was
            # asked before a death survive it. The writer is keyed on (run, source, item), so the
            # end-of-run write re-confirms these rather than duplicating them.
            if record_failures is not None and stamped:
                await record_failures(stamped)

            newly_rejected = await values.append(rejected) if rejected else ()
            stored.extend(newly_rejected)
            await reconfirm(
                _pairs_of(rejected)
                - _pairs_of(newly_rejected)
                - _pairs_of(newly_accepted)
                - contradicted
            )

        # After this attribute is stored, never before it: the cap stops the *next* call, and
        # what has already been paid for is kept. The run one level up sees the exhausted meter
        # and halts, so the attributes left unasked are reported as unanswered rather than
        # silently dropped.
        if meter is not None and meter.has_spent_to_its_cap:
            break

    return RunOutcome(
        stored=tuple(stored),
        failures=tuple(failures),
        cost_eur=cost,
        calls=calls,
    )


_CONTRADICTION = (
    "a different figure is already on record for this observation (same period and retrieval "
    "date); the stored figure stands. Re-read the publisher and give the table a new "
    "transcribed_on"
)


async def _contradicting(fetched: Sequence[Value], values: ValueStore) -> tuple[Value, ...]:
    """The fetched figures whose natural key is on record with another figure or verdict.

    **The batch's own first figure under a key counts as on record**: the read sees only what
    was stored before the batch, and the append that follows keeps the first figure under each
    key and skips the rest, so a later, different one would otherwise vanish unreported.
    """
    on_record = {value.natural_key: value for value in await values.read_observations(fetched)}
    contradicting: list[Value] = []
    for value in fetched:
        standing = on_record.setdefault(value.natural_key, value)
        if not restates(standing, value):
            contradicting.append(value)
    return tuple(contradicting)


def _candidates_settled_by(acquired: Acquired, candidates: Sequence[Candidate]) -> set[str]:
    """The candidates one batch answered or failed -- all of them, for a whole-source failure."""
    if any(failure.candidate is None for failure in acquired.failures):
        return {str(candidate.id) for candidate in candidates}
    return {str(value.candidate) for value in acquired.values} | {
        str(failure.candidate) for failure in acquired.failures
    }


def _pairs_of(values: Iterable[Value]) -> set[tuple[str, str]]:
    return {(str(value.candidate), str(value.attribute)) for value in values}
