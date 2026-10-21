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

import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    DataSource,
    DataSourceId,
    StandIn,
    ValueStore,
)
from starnest.data_acquisition.adapter import (
    Acquired,
    AcquisitionFailure,
    RunningSpend,
    SourceAdapter,
)
from starnest.data_acquisition.estimate import Estimate
from starnest.data_acquisition.freshness import still_fresh_everywhere
from starnest.data_acquisition.run import acquire
from starnest.data_acquisition.spend import CostMeter, refuse_unless_capped
from starnest.data_acquisition.stand_in import STAND_IN, stand_in
from starnest.data_acquisition.store import Run, RunScope, RunStatus, RunStore

_log = logging.getLogger("starnest.acquisition")
"""The narrative behind a run record (`arch.md` 9.4): started, what each source produced, what
failed and with what, and how it ended. **Never a full response body** -- a failure's reason is
the source's own sentence, and the figures themselves are rows in `value`."""

MANUAL = "user"
"""Who asked for it. One user running locally, so there is one answer until something else
starts runs (`reqs.md` 10)."""


@dataclass(frozen=True)
class OpenedRun:
    """A run whose row exists and whose refusals have all been made.

    What `continue_run` needs and nothing more. Frozen because the fetching may happen after
    the response that reported the run has gone, and a mutable plan changing underneath it
    would be a second way for a run to stop meaning what it said.
    """

    id: int
    adapters: Sequence[SourceAdapter]
    answerable: Sequence[Attribute]
    in_scope: Sequence[Attribute]
    candidates: Sequence[Candidate]
    values: ValueStore
    runs: RunStore
    stand_ins: Sequence[StandIn]
    meter: CostMeter


async def open_run(
    *,
    adapters: Sequence[SourceAdapter],
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    runs: RunStore,
    level: str,
    stand_ins: Sequence[StandIn] = (),
    triggered_by: str = MANUAL,
    spend_cap_eur: Decimal | None = None,
    uncapped_is_accepted: bool = False,
    may_borrow_alone: bool = False,
    refetch_older_than: timedelta | None = None,
    now: datetime | None = None,
) -> "OpenedRun":
    """Settle every refusal, write the run row, and hand back what the fetching will need.

    **Split from the fetching so a caller may answer before the work is done** (P35). Everything
    that can refuse a request happens here -- an empty scope, and the spend cap -- so a client
    gets its 409 or its run id, and nothing after this point has anybody to answer to.

    The run row exists before any figure is fetched, which is what makes a process that dies
    mid-run leave a visibly unfinished run rather than nothing at all.

    **Every source, in one run.** A run is one pass, and the plan the household confirmed
    counted the work of all of them; an earlier version handed this the first adapter only,
    which fetched a sixth of what the plan promised while reporting the run completed. **Then
    the declared stand-ins**, visibly and at `low` confidence, where a neighbour's figure is the
    least-bad answer for a place no source covers (`stand_in.py`). Both are `continue_run`'s.

    **The scope recorded is what was asked for, not what worked.** Every candidate and every
    attribute some source could answer goes in, so a country that produced nothing is
    distinguishable afterwards from one nobody asked about -- which is the difference selective
    retry turns on.

    The run is closed `completed` even when items failed. A run completes for everything that
    works and reports the rest (`reqs.md` 6.4); `failed` is for a run that could not proceed at
    all, and treating a sparse indicator as a failed run would mean never completing one.

    **Money, if any source charges** (`reqs.md` 6.3). Nothing is fetched until the cap question
    is settled: a run that can spend and has no cap refuses unless this request accepts an
    uncapped one. Afterwards the spend accumulates per source, and reaching the cap **halts**
    the run -- in-flight work has already committed, everything fetched is kept, and the status
    says why it stopped rather than pretending it finished.
    """
    answerable = [
        attribute
        for attribute in attributes
        if any(attribute.id in adapter.attributes for adapter in adapters)
    ]
    # **Borrowing is work too, and it is not work any source was asked for** (P51). A declared
    # stand-in lends from a figure already stored, so it cannot be *asked* about anything -- and
    # `stand_in` is not an adapter, so a retry of a stand-in failure narrows the source list to
    # nothing and used to be refused with "nothing the sources can answer": true of the sources,
    # and the sources were never what failed.
    borrowable = [
        attribute
        for attribute in attributes
        if any(attribute.id == declared.attribute for declared in stand_ins)
    ]
    # **A borrow is the whole of a run's scope only when somebody asked for the borrow**
    # (`may_borrow_alone`, set by a retry of stand-in failures -- P51). Ordinary runs are left
    # exactly as they were, which three earlier versions of this fix were not: putting
    # borrowable attributes into every run's scope inflated `items_total` by candidates x
    # attributes for work nobody asked a source to do, handing them to the borrow step alone
    # attempted Liechtenstein's three declared borrows on every unrelated run and recorded each
    # as a failure, and treating "no adapters" as borrow-only overturned P27 -- an unscoped
    # sweep whose only source charges must still refuse rather than record a run for nothing.
    # **What is still fresh everywhere is not asked about again** (`reqs.md` 3.10, Q233).
    # Null skips nothing, which is the shipped state and exactly what the planner did before
    # this existed -- so a run's scope only ever narrows because somebody set a number.
    fresh = await attributes_still_fresh(
        runs=runs,
        level=level,
        attributes=answerable,
        candidates=candidates,
        refetch_older_than=refetch_older_than,
        now=now,
    )
    answerable = [attribute for attribute in answerable if str(attribute.id) not in fresh]

    in_scope = answerable or (borrowable if may_borrow_alone else [])
    scope = RunScope(
        level=level,
        candidates=tuple(str(candidate.id) for candidate in candidates),
        attributes=tuple(str(attribute.id) for attribute in in_scope),
    )
    if not in_scope or not candidates:
        # Named separately, because it is the one cause with an obvious remedy: there is
        # nothing to ask rather than nothing worth asking about.
        if fresh:
            # Named separately: the scope was not empty, it was emptied by the freshness
            # rule, and "nothing to fetch" would read as a fault rather than as a run that
            # had nothing left to do.
            raise NothingToFetchError(
                f"every attribute in this run's scope was fetched within the last "
                f"{_in_days(refetch_older_than)}, so there is nothing to ask about again. Lower "
                f"'refetch data older than' in Configure to ask anyway"
            )
        if not adapters:
            raise NothingToFetchError(
                "no data source is switched on, so there is nothing to ask. Switch one on in "
                "Configure, or this run would fetch nothing and record that it had run"
            )
        raise NothingToFetchError(
            "nothing in this run's scope can be answered by the sources it may ask or borrowed "
            f"from a declared stand-in: {len(candidates)} candidate(s), "
            f"{len(answerable)} answerable and {len(borrowable)} borrowable attribute(s)"
        )
    refuse_unless_capped(
        costs_money=_a_paid_source_would_be_asked(adapters, answerable),
        cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
    )

    run = await runs.start_run(scope, triggered_by=triggered_by)
    _log.info(
        "run %d started by %s over %d candidates and %d attributes, from %d source(s)",
        run,
        triggered_by,
        len(candidates),
        len(answerable),
        len(adapters),
    )
    return OpenedRun(
        id=run,
        adapters=adapters,
        answerable=answerable,
        in_scope=in_scope,
        candidates=candidates,
        values=values,
        runs=runs,
        stand_ins=stand_ins,
        meter=CostMeter(cap_eur=spend_cap_eur),
    )


def _in_days(age: timedelta) -> str:
    """An age as the household set it: "30 days", "1 day" (NEW-37).

    The setting is a whole number of days (`refetch_older_than_days`), and an interval printed
    as itself read "30 days, 0:00:00" -- a clock time nobody chose, in the sentence telling
    somebody which setting to lower.
    """
    return f"{age.days} day" if age.days == 1 else f"{age.days} days"


async def attributes_still_fresh(
    *,
    runs: RunStore,
    level: str,
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    refetch_older_than: timedelta | None,
    now: datetime | None = None,
) -> frozenset[str]:
    """The attributes every candidate already holds a fresh figure for (`reqs.md` 3.10, Q233).

    **One answer for a run and for its plan** (BE-25). `open_run` drops these from what it asks,
    and the plan has to drop the same ones, or the estimate the household confirms counts work
    the run then skips.

    A null age reads nothing: nothing can be fresh before somebody says what fresh means.
    """
    if refetch_older_than is None:
        return frozenset()
    attribute_ids = [str(attribute.id) for attribute in attributes]
    candidate_ids = [str(candidate.id) for candidate in candidates]
    return still_fresh_everywhere(
        attributes=attribute_ids,
        candidates=candidate_ids,
        last_retrieved=await runs.last_retrieved(
            level=level, candidates=candidate_ids, attributes=attribute_ids
        ),
        refetch_older_than=refetch_older_than,
        now=now or datetime.now(UTC),
    )


async def _halt(
    run: int,
    runs: RunStore,
    candidates: Sequence[Candidate],
    failures: Sequence[AcquisitionFailure],
    status: RunStatus,
) -> Run:
    """End a run early, keeping everything it had written.

    **One path for both halts**, because they differ only in the word they record. A second
    copy of "write the failures, close the run, read it back" is where the spend cap and a
    user's stop would quietly stop behaving the same -- and "nothing is lost" is the promise
    both of them make.
    """
    await runs.record_failures(run, _item_by_item(failures, candidates))
    await runs.finish_run(run, status=status, finished_at=datetime.now(tz=UTC))
    return await runs.read_run(run)


async def continue_run(opened: OpenedRun) -> Run:
    """Fetch everything the opened run covers, record what happened, and close it.

    **The half that takes the time**, and the half a caller may choose not to wait for. Every
    refusal has already been made by `open_run`, so nothing here answers a client: what it can
    do is fail, and a failure is written onto the run rather than raised at anybody.

    A process that dies partway leaves the run `running`, which the startup sweep turns into
    `failed` (`arch.md` 9.2) -- the same state a killed run has always left, and the reason
    that sweep exists.
    """
    run, runs, candidates = opened.id, opened.runs, opened.candidates
    meter = opened.meter

    failures: list[AcquisitionFailure] = []
    try:
        for adapter in opened.adapters:
            # **Asked between sources, never mid-fetch.** A source's fetch is one request over
            # every candidate in most adapters, so this is the finest grain at which a run can
            # be interrupted without abandoning a request already in flight -- and abandoning
            # one would lose figures the publisher had already sent. It is the same checkpoint
            # the spend cap uses, for the same reason.
            if await runs.stop_was_requested(run):
                _log.info("run %d was stopped before %s was asked", run, adapter.data_source)
                return await _halt(run, runs, candidates, failures, RunStatus.HALTED_BY_USER)

            outcome = await acquire(
                adapter=adapter,
                attributes=opened.answerable,
                candidates=candidates,
                values=opened.values,
                run=run,
                # **The meter goes in, so the cap can stop a sweep partway through a source**
                # (P47). It records each answer's cost itself, which is why nothing accumulates
                # into it below.
                meter=meter,
                # **This run's own list, filled as each attribute is answered.** The outcome
                # carries the same failures, and extending from it here would double them --
                # what this buys is that a `fetch` raising partway through leaves the ones
                # already found in hand (P66).
                collecting=failures,
                # **The spend is written as each batch is billed, not once the source ends**
                # (BE-33, closing P36): a death mid-sweep then keeps the record of what it had
                # already cost, as BE-19 keeps the figures. The sum is the source's total.
                record_spend=lambda calls, cost: runs.add_spend(run, calls=calls, cost_eur=cost),
            )
            _log.info(
                "run %d: %s answered %d figure(s) and failed on %d",
                run,
                adapter.data_source,
                len(outcome.stored),
                len(outcome.failures),
            )
            # **Logged before the cap is read** (NEW-14). The halt below returns, and a source
            # that reached the cap used to leave none of its failures in the log.
            for failure in outcome.failures:
                # The only way a parse failure is diagnosable (`arch.md` 9.4, 5.3): the source,
                # the item, and the source's own words about it.
                _log.warning(
                    "run %d: %s could not answer %s for %s: %s",
                    run,
                    adapter.data_source,
                    failure.attribute,
                    failure.candidate or "any candidate",
                    failure.reason,
                )
            if outcome.calls or outcome.cost_eur:
                # `acquire` has both metered this per answer and written it to the run durably,
                # batch by batch (BE-33). Here only the running total is logged, so a halt is
                # never a surprise (`arch.md` 9.4).
                _log.info("run %d spend: %s", run, meter.describe())
            if meter.has_spent_to_its_cap:
                # The cap is a stop, not a failure. What was fetched is stored and the status
                # says why it stopped -- so a retry over the rest is the obvious next step.
                #
                # **Checked before the stop request**, so a run that hit its cap reports the
                # cap even if somebody also clicked Stop: it would have halted either way, and
                # the money is the fact a reader needs.
                _log.warning("run %d halted on its spend cap: %s", run, meter.describe())
                return await _halt(run, runs, candidates, failures, RunStatus.HALTED_ON_SPEND_CAP)
        # **Asked once more after the last source** (P88). The check above runs *before* each
        # adapter, so a run with one source -- or a stop arriving while the last one was
        # working -- finished `completed` with `stop_requested_at` set, and went on to borrow
        # stand-ins after the person had asked it to stop. A stop is a request to stop doing
        # more work, and borrowing is more work.
        if await runs.stop_was_requested(run):
            _log.info("run %d was stopped before the stand-ins were applied", run)
            return await _halt(run, runs, candidates, failures, RunStatus.HALTED_BY_USER)

        # Last, so a substitute's figure fetched in this same run is the one borrowed.
        borrowed = await stand_in(
            stand_ins=opened.stand_ins,
            attributes=opened.in_scope,
            candidates=candidates,
            values=opened.values,
            run=run,
        )
        failures.extend(borrowed.failures)
    except Exception:
        # The run stays visible as one that could not proceed, rather than as one still
        # running for ever. Re-raised because an unexpected failure is a bug, and a tidy
        # record of it is not a reason to swallow it.
        #
        # **The failures collected before the fault are written first** (P66). This path used
        # to close the run without them, so a source that declined three items and a later
        # source that raised produced a `failed` run with `items_failed` 0 and no failure rows
        # -- and a retry answering "failed on nothing, so there is nothing to retry" about a
        # run that failed on three things. The success path and both halts have always recorded
        # them; this was the one exit that did not, on the path where a source's outage is
        # likeliest. A second fault while recording must not mask the first, so it is logged
        # and the original exception is the one that propagates.
        _log.exception("run %d could not proceed and is recorded as failed", run)
        try:
            await runs.record_failures(run, _item_by_item(failures, candidates))
        except Exception:
            _log.exception("run %d could not even record what it had failed on", run)
        await runs.finish_run(run, status=RunStatus.FAILED, finished_at=datetime.now(tz=UTC))
        raise

    await runs.record_failures(run, _item_by_item(failures, candidates))
    await runs.finish_run(run, status=RunStatus.COMPLETED, finished_at=datetime.now(tz=UTC))
    finished = await runs.read_run(run)
    _log.info(
        "run %d completed: %d of %d items answered, %d failed, %d unanswered",
        run,
        finished.items_completed,
        finished.items_total,
        finished.items_failed,
        finished.items_unanswered,
    )
    return finished


async def execute_run(**asked: object) -> Run:
    """Open a run and see it through, in one call.

    What every caller that *does* want to wait uses -- the retry, asking again, and the tests.
    `api/runs.py` is the one caller that splits the two, because it has a client waiting for an
    answer that should not depend on how long a sweep takes (P35).
    """
    return await continue_run(await open_run(**asked))  # type: ignore[arg-type]


def _item_by_item(
    failures: Sequence[AcquisitionFailure], candidates: Sequence[Candidate]
) -> list[AcquisitionFailure]:
    """Every failure against the candidate it failed for -- a whole-source failure against all.

    A source that could not be reached at all -- OECD behind a browser challenge -- fails once,
    for no candidate in particular. It did fail for every candidate the run asked it about, and
    recording it that way is what keeps it visible and retryable. An earlier version skipped it,
    saying the run's status would carry it; the status said `completed`, and a whole source's
    outage left no trace on the run.
    """
    itemised: list[AcquisitionFailure] = []
    for failure in failures:
        if failure.candidate is not None:
            itemised.append(failure)
        else:
            itemised.extend(
                replace(failure, candidate=str(candidate.id)) for candidate in candidates
            )
    return itemised


def switched_on(
    adapters: Sequence[SourceAdapter], sources: Sequence[DataSource]
) -> tuple[SourceAdapter, ...]:
    """The adapters whose source is switched on (`reqs.md` 2, Q232).

    **A source the household has switched off is not asked.** The same switch also keeps its
    stored values out of the active-value comparison, so asking it again would fetch figures
    that cannot score -- work nobody wants, paid for in the case of a source that charges.

    An adapter whose source is not in the catalog at all is kept rather than dropped: that is
    a declaration fault the boot check exists to catch, and silently skipping it here would
    hide it behind a run that merely fetched less than it should have.
    """
    switched_off = {source.id for source in sources if not source.is_enabled}
    return tuple(adapter for adapter in adapters if adapter.data_source not in switched_off)


def stand_ins_if_enabled(
    stand_ins: Sequence[StandIn], sources: Sequence[DataSource]
) -> Sequence[StandIn]:
    """No figures are borrowed when the `stand_in` source is switched off (`reqs.md` 2, BE-15).

    A declared stand-in is consulted like any other source, so the same switch that keeps a
    disabled source out of a run keeps borrowing out too -- otherwise a disabled `stand_in` still
    stored copies that `active_value` then discards, which is work nobody asked for.
    """
    off = {source.id for source in sources if not source.is_enabled}
    return () if STAND_IN in off else stand_ins


def asked_this_run(
    adapters: Sequence[SourceAdapter], *, attributes_named: bool
) -> tuple[SourceAdapter, ...]:
    """The sources a run may ask, given whether it named the attributes it wants.

    **A source that charges is asked only when the run names what it is for.** The free
    structured sources answer whole indicators and a sweep of all of them costs nothing, so a
    run over a level asks them all. The LLM path is per candidate and per attribute, so the same
    sweep would be hundreds of paid calls nobody asked for -- it would halt on the cap, safely,
    and having to explain that to somebody is not a design.

    So an unscoped run is free by construction, and spending is something the household does on
    purpose: name the attribute, and the paid source is asked about it.
    """
    if attributes_named:
        return tuple(adapters)
    return tuple(adapter for adapter in adapters if not adapter.costs_money)


def _a_paid_source_would_be_asked(
    adapters: Sequence[SourceAdapter], answerable: Sequence[Attribute]
) -> bool:
    """Whether this run will actually ask a source that charges (BE-14).

    `any(adapter.costs_money ...)` over the whole asked list counted a paid source that declares
    none of the run's attributes: a run naming only Eurostat attributes was refused for want of a
    cap because the LLM adapter was merely registered, though it would answer nothing and the
    plan priced it at zero. A paid source charges this run only when it declares an attribute the
    run is going to ask about, and `acquire` asks each source only about what it declares.
    """
    in_scope = {str(attribute.id) for attribute in answerable}
    return any(
        adapter.costs_money and not in_scope.isdisjoint(str(a) for a in adapter.attributes)
        for adapter in adapters
    )


class NothingToFetchError(ValueError):
    """A run whose sources, between them, can answer nothing in its scope.

    Refused rather than opened: a run over an empty scope is a no-op recorded as though it were
    work, and the run list is a record of what was actually asked. It happens for two honest
    reasons -- an unscoped run over a registry whose only source charges, which
    `asked_this_run` declines to ask; and a run with every source switched off, which
    `switched_on` leaves nothing of. The second is reachable in a few clicks, so its refusal
    names the remedy rather than the arithmetic.
    """


class RunAlreadyInFlightError(ValueError):
    """A run was asked for while one was already going (P35).

    **One household on one machine runs one pass at a time** (`reqs.md` 10), and
    `sweep_abandoned_runs` already depends on that: it turns whatever is still `running` at boot
    into `failed`, because a run in flight when nothing is running it is a run whose process
    died. Nothing enforced the rule at the other end.

    That is what made the 2.70 EUR mistake possible. Starting a run answers 202 and then blocks
    for the whole run, so a client timeout is indistinguishable from a failure -- and the
    obvious response to a failure is to try again, which started a second paid run beside the
    first. A state conflict, so the API answers 409 and names the run to poll instead.
    """


class NothingToRetryError(ValueError):
    """A retry of a run that failed on nothing. A new run over an empty scope would be a no-op
    recorded as though it were work."""


async def retry_run(
    *,
    failed: Run,
    adapters: Sequence[SourceAdapter],
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    runs: RunStore,
    stand_ins: Sequence[StandIn] = (),
    triggered_by: str = MANUAL,
    spend_cap_eur: Decimal | None = None,
    uncapped_is_accepted: bool = False,
    execute: "Callable[..., Awaitable[Run]]" = execute_run,
) -> Run:
    """A new run asking only the sources that failed, only about what they failed on.

    **`execute` opens and runs the narrowed scope** (default: `execute_run`, which waits for the
    whole pass -- what the tests and scripts want). `api/runs.py` passes one that opens the run,
    dispatches the fetch to the background and returns at once, so a retry answers 202 without
    holding a connection open and cannot be mistaken for a failure and retried into a second
    paid run (BE-12), exactly as `start` does (P35).

    `reqs.md` 6.4. `attributes` and `candidates` are the level's whole catalog and roster; the
    retry narrows both to the failures. **The old run is untouched** -- it keeps its record of
    what went wrong, and the new one records what happened this time.

    **Each source is asked only about the attributes and the candidates *it* failed on.** OECD
    failing on the tax rate does not re-ask the estimate that answered it, and Eurostat failing
    on Portugal does not send the LLM, which failed only on Spain, back to Portugal (NEW-48).
    Asking a source about a candidate that did not fail was once said to cost nothing, since a
    structured source answers a whole indicator in one request. The LLM adapters ask and bill
    per candidate, and since BE-08 every figure rejected by its credible range is a failure --
    so one source's failure billed another again for a country it had already answered (BE-11).

    **The scope is still the smallest one covering the failures**: every failed candidate against
    every failed attribute, because a run's scope is two lists. So it can name a pair no source
    is asked about, which the new run counts as unanswered, and a source that failed on two pairs
    is still asked about the rectangle they span -- but never about another source's failures.

    Declared stand-ins run afterwards as in any run, so a substitute's figure that arrives in the
    retry is lent on in the same pass.
    """
    if not failed.failures or failed.scope is None:
        raise NothingToRetryError(
            f"run {failed.id} failed on nothing, so there is nothing to retry"
        )

    failed_on = _what_each_source_failed_on(failed.failures)
    wanted_candidates = {failure.candidate for failure in failed.failures}
    wanted_attributes = {failure.attribute for failure in failed.failures}
    return await execute(
        adapters=[
            _AskedOnlyAbout(adapter, failed_on[adapter.data_source])
            for adapter in adapters
            if adapter.data_source in failed_on
        ],
        attributes=[attribute for attribute in attributes if attribute.id in wanted_attributes],
        candidates=[candidate for candidate in candidates if candidate.id in wanted_candidates],
        values=values,
        runs=runs,
        level=failed.scope.level,
        stand_ins=stand_ins,
        triggered_by=triggered_by,
        # A retry is a run and spends like one. It reaches the sources that failed, which is
        # where a paid source is most likely to be -- a source that charges fails more ways
        # than one that serves a file (P42).
        spend_cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
        # **The borrow may be the only work this retry has** (P51). `stand_in` is not an
        # adapter, so a run whose only failures came from borrowing narrows the source list to
        # nothing -- and the borrow is exactly what the household asked to go back to.
        may_borrow_alone=any(failure.data_source == STAND_IN for failure in failed.failures),
    )


@dataclass(frozen=True)
class _FailedOn:
    """What one source failed on in the run being retried, and so all it is asked about again."""

    attributes: frozenset[AttributeId]
    candidates: frozenset[str | None]


def _what_each_source_failed_on(
    failures: Sequence[AcquisitionFailure],
) -> dict[DataSourceId | None, _FailedOn]:
    by_source: dict[DataSourceId | None, list[AcquisitionFailure]] = {}
    for failure in failures:
        by_source.setdefault(failure.data_source, []).append(failure)
    return {
        source: _FailedOn(
            attributes=frozenset(failure.attribute for failure in its_failures),
            candidates=frozenset(failure.candidate for failure in its_failures),
        )
        for source, its_failures in by_source.items()
    }


class _AskedOnlyAbout(SourceAdapter):
    """A source, narrowed to the attributes a retry should ask it about again.

    **It forwards everything except the narrowing itself** (P41). This wrapper once forwarded
    three members and inherited the rest, and `SourceAdapter`'s defaults -- `costs_money = False`
    and an estimate of nothing -- are written for a *new* adapter, where a source that charges
    should have to say so. Inherited by a wrapper they say the opposite of what the wrapped
    source says, and they say it in the direction of spending money: a retry of a failed LLM run
    reported itself free, so nothing asked for a spend cap and the meter it was given had none.
    A delegating subclass forwards all of its subject or none of it.

    **That includes the run's meter** (BE-10). Inherited, `meter_with` was the base's no-op, so
    a paid source asked again kept the meter of whichever run it last served: an exhausted one
    refused every candidate of the retry, and a live one recorded the retry's calls against
    another run's cap.

    **The candidates are narrowed here too, where the source is asked** (NEW-48, BE-11). A run
    hands every source the same candidate list -- the retry's, drawn from every source's failures
    -- so one source's failure would send another, billing per candidate, back to a country it
    had already answered. The narrowing happens in both `fetch` and `fetch_in_batches`, because a
    run fetches through the latter (BE-19) and only the former would leave the paid path unfixed.
    """

    def __init__(self, adapter: SourceAdapter, failed_on: _FailedOn) -> None:
        self._adapter = adapter
        self._failed_on = failed_on

    def _only_the_candidates_it_failed_on(self, candidates: Sequence[Candidate]) -> list[Candidate]:
        return [c for c in candidates if c.id in self._failed_on.candidates]

    @property
    def data_source(self) -> DataSourceId:
        return self._adapter.data_source

    @property
    def costs_money(self) -> bool:
        return self._adapter.costs_money

    def estimate_for(self, items: int) -> Estimate:
        return self._adapter.estimate_for(items)

    def meter_with(self, meter: RunningSpend) -> None:
        self._adapter.meter_with(meter)

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(a for a in self._adapter.attributes if a in self._failed_on.attributes)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        failed_for = self._only_the_candidates_it_failed_on(candidates)
        # Nothing left to ask is not a question, and a source charging per request would still
        # bill one about nobody.
        if not failed_for:
            return Acquired()
        return await self._adapter.fetch(attribute, failed_for)

    async def fetch_in_batches(
        self, attribute: Attribute, candidates: Sequence[Candidate]
    ) -> AsyncIterator[Acquired]:
        # Narrowed to this source's own failed candidates (NEW-48) and forwarded like the rest
        # (P41): a run fetches through here (BE-19), so leaving it unfiltered would send a paid
        # source back to a candidate another source failed on -- and buffer the whole attribute,
        # losing the per-candidate durability the run relies on.
        failed_for = self._only_the_candidates_it_failed_on(candidates)
        if not failed_for:
            return
        async for batch in self._adapter.fetch_in_batches(attribute, failed_for):
            yield batch


class NothingToAskAgainError(ValueError):
    """A run where every item was either answered or failed. There is nothing unanswered to ask
    about, and a new run over an empty scope would be a no-op recorded as work."""


async def ask_again(
    *,
    run: Run,
    adapters: Sequence[SourceAdapter],
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    runs: RunStore,
    stand_ins: Sequence[StandIn] = (),
    triggered_by: str = MANUAL,
    spend_cap_eur: Decimal | None = None,
    uncapped_is_accepted: bool = False,
    execute: "Callable[..., Awaitable[Run]]" = execute_run,
) -> Run:
    """A new run asking again about the items nobody answered (`reqs.md` Q217).

    `execute` is the same seam `retry_run` has: the endpoint passes one that dispatches the fetch
    to the background and returns 202 at once, rather than blocking (BE-12).

    **No source is narrowed to, because no source failed.** A retry asks the source that broke;
    this asks every source that can answer the attribute, because the previous run's silence
    says only that none of the ones asked had a row. Where a dataset genuinely does not cover a
    country, this will change nothing -- which is why it is a separate act the household chooses
    rather than part of a retry.

    **The old run is untouched**, as it is for a retry: it keeps its account of what it asked and
    what came back.
    """
    if not run.unanswered or run.scope is None:
        raise NothingToAskAgainError(
            f"run {run.id} has no unanswered items, so there is nothing to ask again about"
        )

    wanted_candidates = {item.candidate for item in run.unanswered}
    wanted_attributes = {item.attribute for item in run.unanswered}
    return await execute(
        adapters=adapters,
        attributes=[a for a in attributes if str(a.id) in wanted_attributes],
        candidates=[c for c in candidates if str(c.id) in wanted_candidates],
        values=values,
        runs=runs,
        level=run.scope.level,
        stand_ins=stand_ins,
        triggered_by=triggered_by,
        # It asks *every* source that can answer rather than the one that failed, so if
        # anything it reaches a paid source more readily than a retry does.
        spend_cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
    )
