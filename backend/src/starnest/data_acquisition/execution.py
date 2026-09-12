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
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import Attribute, AttributeId, DataSourceId, StandIn, ValueStore
from starnest.data_acquisition.adapter import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_acquisition.run import acquire
from starnest.data_acquisition.spend import CostMeter, refuse_unless_capped
from starnest.data_acquisition.stand_in import stand_in
from starnest.data_acquisition.store import Run, RunScope, RunStatus, RunStore

_log = logging.getLogger("starnest.acquisition")
"""The narrative behind a run record (`arch.md` 9.4): started, what each source produced, what
failed and with what, and how it ended. **Never a full response body** -- a failure's reason is
the source's own sentence, and the figures themselves are rows in `value`."""

MANUAL = "user"
"""Who asked for it. One user running locally, so there is one answer until something else
starts runs (`reqs.md` 10)."""


async def execute_run(
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
) -> Run:
    """Open a run, fetch everything in scope from every source, record what happened, close it.

    **Every source, in one run.** A run is one pass, and the plan the household confirmed
    counted the work of all of them; an earlier version handed this the first adapter only,
    which fetched a sixth of what the plan promised while reporting the run completed. **Then
    the declared stand-ins**, visibly and at `low` confidence, where a neighbour's figure is the
    least-bad answer for a place no source covers (`stand_in.py`).

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
    scope = RunScope(
        level=level,
        candidates=tuple(str(candidate.id) for candidate in candidates),
        attributes=tuple(str(attribute.id) for attribute in answerable),
    )
    if not answerable or not candidates:
        raise NothingToFetchError(
            "nothing in this run's scope can be answered by the sources it may ask: "
            f"{len(candidates)} candidate(s) and {len(answerable)} answerable attribute(s)"
        )
    refuse_unless_capped(
        costs_money=any(adapter.costs_money for adapter in adapters),
        cap_eur=spend_cap_eur,
        uncapped_is_accepted=uncapped_is_accepted,
    )
    meter = CostMeter(cap_eur=spend_cap_eur)

    run = await runs.start_run(scope, triggered_by=triggered_by)
    _log.info(
        "run %d started by %s over %d candidates and %d attributes, from %d source(s)",
        run,
        triggered_by,
        len(candidates),
        len(answerable),
        len(adapters),
    )

    failures: list[AcquisitionFailure] = []
    try:
        for adapter in adapters:
            outcome = await acquire(
                adapter=adapter,
                attributes=answerable,
                candidates=candidates,
                values=values,
                run=run,
            )
            failures.extend(outcome.failures)
            _log.info(
                "run %d: %s answered %d figure(s) and failed on %d",
                run,
                adapter.data_source,
                len(outcome.stored),
                len(outcome.failures),
            )
            if outcome.calls or outcome.cost_eur:
                meter.spent(cost_eur=outcome.cost_eur, calls=outcome.calls)
                await runs.add_spend(run, calls=outcome.calls, cost_eur=outcome.cost_eur)
                # Logged as it accumulates, so a halt is never a surprise (`arch.md` 9.4).
                _log.info("run %d spend: %s", run, meter.describe())
            if meter.is_exhausted:
                # The cap is a stop, not a failure. What was fetched is stored and the status
                # says why it stopped -- so a retry over the rest is the obvious next step.
                _log.warning("run %d halted on its spend cap: %s", run, meter.describe())
                await runs.record_failures(run, _item_by_item(failures, candidates))
                await runs.finish_run(
                    run,
                    status=RunStatus.HALTED_ON_SPEND_CAP,
                    finished_at=datetime.now(tz=UTC),
                )
                return await runs.read_run(run)

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
        # Last, so a substitute's figure fetched in this same run is the one borrowed.
        borrowed = await stand_in(
            stand_ins=stand_ins,
            attributes=answerable,
            candidates=candidates,
            values=values,
            run=run,
        )
        failures.extend(borrowed.failures)
    except Exception:
        # The run stays visible as one that could not proceed, rather than as one still
        # running for ever. Re-raised because an unexpected failure is a bug, and a tidy
        # record of it is not a reason to swallow it.
        _log.exception("run %d could not proceed and is recorded as failed", run)
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


class NothingToFetchError(ValueError):
    """A run whose sources, between them, can answer nothing in its scope.

    Refused rather than opened: a run over an empty scope is a no-op recorded as though it were
    work, and the run list is a record of what was actually asked. It happens for one honest
    reason -- an unscoped run over a registry whose only source charges, which `asked_this_run`
    declines to ask.
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
) -> Run:
    """A new run asking only the sources that failed, only about what they failed on.

    `reqs.md` 6.4. `attributes` and `candidates` are the level's whole catalog and roster; the
    retry narrows both to the failures. **The old run is untouched** -- it keeps its record of
    what went wrong, and the new one records what happened this time.

    **The scope is the smallest one covering the failures**: every failed candidate against every
    failed attribute. Each source is asked only about the attributes *it* failed on, so OECD
    failing on the tax rate does not re-ask the estimate that answered it. Asking a source about
    a candidate that did not fail costs nothing extra -- every source here answers a whole
    indicator in one request -- and stores one more observation of a figure already held.

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
    return await execute_run(
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
    )


def _what_each_source_failed_on(
    failures: Sequence[AcquisitionFailure],
) -> dict[DataSourceId | None, frozenset[AttributeId]]:
    by_source: dict[DataSourceId | None, set[AttributeId]] = {}
    for failure in failures:
        by_source.setdefault(failure.data_source, set()).add(failure.attribute)
    return {source: frozenset(failed_on) for source, failed_on in by_source.items()}


class _AskedOnlyAbout(SourceAdapter):
    """A source, narrowed to the attributes a retry should ask it about again."""

    def __init__(self, adapter: SourceAdapter, attributes: frozenset[AttributeId]) -> None:
        self._adapter = adapter
        self._attributes = attributes

    @property
    def data_source(self) -> DataSourceId:
        return self._adapter.data_source

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(a for a in self._adapter.attributes if a in self._attributes)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        return await self._adapter.fetch(attribute, candidates)


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
) -> Run:
    """A new run asking again about the items nobody answered (`reqs.md` Q217).

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
    return await execute_run(
        adapters=adapters,
        attributes=[a for a in attributes if str(a.id) in wanted_attributes],
        candidates=[c for c in candidates if str(c.id) in wanted_candidates],
        values=values,
        runs=runs,
        level=run.scope.level,
        stand_ins=stand_ins,
        triggered_by=triggered_by,
    )
