"""What a run records as its plan before it asks anything (PL-055, PL-056; D17, C04-N6).

The plan is recorded so the run can later tell "asked, and nobody had a row" from "never asked",
and show each source's progress against it. It is only worth anything if it counts exactly what
`continue_run` then asks -- so each test here runs a pass and compares the recorded plan with
the questions the stub sources were actually posed.
"""

from decimal import Decimal

import pytest

from starnest.data import DataSourceId
from starnest.data_acquisition import (
    STAND_IN,
    AcquisitionFailure,
    Run,
    RunPlan,
    RunScope,
    RunStatus,
    SpendCapNotSetError,
    UnansweredItem,
    ask_again,
    execute_run,
    plan_sources,
    priced,
    retry_run,
)

from .test_ask_again import (
    LIECHTENSTEIN,
    OVERBURDEN,
    OVERCROWDING,
    PORTUGAL,
    RecordingRunStore,
    RecordingValueStore,
    StubSource,
    a_run,
    a_value,
    an_attribute,
    switzerland_stands_in_for_liechtenstein,
)
from .test_retry import PaidPerCandidate

BOTH_ATTRIBUTES = [an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)]
BOTH_CANDIDATES = [LIECHTENSTEIN, PORTUGAL]


def a_finished_run(scope: RunScope) -> Run:
    return a_run(unanswered=(), scope=scope)


def what_was_asked(*sources: StubSource) -> dict[tuple[str, str], int]:
    asked: dict[tuple[str, str], int] = {}
    for source in sources:
        for attribute, candidates in source.asked:
            key = (str(source.data_source), attribute)
            asked[key] = asked.get(key, 0) + len(candidates)
    return asked


async def a_sweep(
    *sources: object, runs: RecordingRunStore, stand_ins=(), **asked: object
) -> RunPlan:
    await execute_run(
        adapters=list(sources),
        attributes=BOTH_ATTRIBUTES,
        candidates=BOTH_CANDIDATES,
        values=RecordingValueStore(holds=(a_value("country.switzerland", OVERBURDEN),)),
        runs=runs,
        level="country",
        stand_ins=list(stand_ins),
        **asked,
    )
    plan = runs.plans[-1]
    assert plan is not None
    return plan


class TestWhatTheRunPlans:
    async def test_a_sweep_plans_what_each_source_is_then_asked(self) -> None:
        eurostat = StubSource("eurostat", declares=(OVERBURDEN, OVERCROWDING), covers=())
        oecd = StubSource("oecd", declares=(OVERBURDEN,), covers=())
        runs = RecordingRunStore(answers_with=a_finished_run(None))

        plan = await a_sweep(eurostat, oecd, runs=runs)

        assert dict(plan.items_planned) == what_was_asked(eurostat, oecd)
        assert dict(plan.items_planned) == {
            ("eurostat", OVERBURDEN): 2,
            ("eurostat", OVERCROWDING): 2,
            ("oecd", OVERBURDEN): 2,
        }

    async def test_a_borrow_is_planned_under_the_stand_in_source(self) -> None:
        runs = RecordingRunStore(answers_with=a_finished_run(None))

        plan = await a_sweep(
            StubSource("eurostat", declares=(OVERBURDEN,), covers=()),
            runs=runs,
            stand_ins=[switzerland_stands_in_for_liechtenstein(OVERBURDEN)],
        )

        assert plan.items_planned[(str(STAND_IN), OVERBURDEN)] == 1

    async def test_a_retry_plans_only_the_pairs_each_source_failed_on(self) -> None:
        """Mutation: counting the rectangle the retry's two lists span plans four items for a
        source that failed on two, and a paid source's ceiling doubles with it."""
        failed = Run(
            id=17,
            status=RunStatus.COMPLETED,
            started_at=a_run(()).started_at,
            triggered_by="user",
            scope=RunScope(level="country"),
            failures=(
                AcquisitionFailure(
                    OVERBURDEN, "no", candidate="country.portugal", data_source="eurostat"
                ),
                AcquisitionFailure(
                    OVERCROWDING, "no", candidate="country.liechtenstein", data_source="eurostat"
                ),
            ),
        )
        eurostat = StubSource("eurostat", declares=(OVERBURDEN, OVERCROWDING), covers=())
        runs = RecordingRunStore(answers_with=failed)

        await retry_run(
            failed=failed,
            adapters=[eurostat],
            attributes=BOTH_ATTRIBUTES,
            candidates=BOTH_CANDIDATES,
            values=RecordingValueStore(),
            runs=runs,
        )

        plan = runs.plans[-1]
        assert plan is not None
        assert dict(plan.items_planned) == what_was_asked(eurostat)
        assert dict(plan.items_planned) == {
            ("eurostat", OVERBURDEN): 1,
            ("eurostat", OVERCROWDING): 1,
        }

    async def test_asking_again_plans_only_the_items_it_asks_about(self) -> None:
        unanswered = (UnansweredItem(candidate="country.liechtenstein", attribute=OVERBURDEN),)
        eurostat = StubSource("eurostat", declares=(OVERBURDEN, OVERCROWDING), covers=())
        runs = RecordingRunStore(answers_with=a_run(unanswered))

        await ask_again(
            run=a_run(unanswered),
            adapters=[eurostat],
            attributes=BOTH_ATTRIBUTES,
            candidates=BOTH_CANDIDATES,
            values=RecordingValueStore(),
            runs=runs,
        )

        plan = runs.plans[-1]
        assert plan is not None
        assert dict(plan.items_planned) == {("eurostat", OVERBURDEN): 1}
        assert dict(plan.items_planned) == what_was_asked(eurostat)


class TestHowFarEachSourceGot:
    async def test_a_completed_run_marks_everything_it_planned(self) -> None:
        """The invariant a completed run reads by: nothing it planned is left unfinished, or its
        empty items would read "not reached" though every source was asked."""
        runs = RecordingRunStore(answers_with=a_finished_run(None))

        plan = await a_sweep(
            StubSource("eurostat", declares=(OVERBURDEN, OVERCROWDING), covers=()),
            StubSource("oecd", declares=(OVERBURDEN,), covers=()),
            runs=runs,
            stand_ins=[switzerland_stands_in_for_liechtenstein(OVERBURDEN)],
        )

        assert sorted(runs.marked) == sorted(plan.items_planned)

    async def test_a_source_the_cap_halted_leaves_the_rest_unmarked(self) -> None:
        """The paid source spends its 1.00 cap on Liechtenstein's first attribute, so Portugal
        was never asked about it and nothing after it was reached."""
        runs = RecordingRunStore(answers_with=a_finished_run(None))
        paid = PaidPerCandidate(declares=(OVERBURDEN, OVERCROWDING))

        await a_sweep(paid, runs=runs, spend_cap_eur=Decimal("1.00"))

        assert runs.marked == []


class TestWhatTheRunMayCost:
    async def test_the_ceiling_is_what_the_plan_endpoint_prices(self) -> None:
        """One answer for a run and its plan (BE-25): two attributes over two candidates at one
        euro a candidate is four euros, whichever of the two asks."""
        runs = RecordingRunStore(answers_with=a_finished_run(None))
        paid = PaidPerCandidate(declares=(OVERBURDEN, OVERCROWDING))

        plan = await a_sweep(paid, runs=runs, spend_cap_eur=Decimal("50"))

        assert plan.estimate_ceiling_eur == Decimal("4.00")
        assert (
            plan.estimate_ceiling_eur
            == priced(plan_sources([paid], BOTH_ATTRIBUTES, BOTH_CANDIDATES)).cost_eur
        )

    async def test_a_retry_s_ceiling_prices_only_its_pairs(self) -> None:
        failed = Run(
            id=17,
            status=RunStatus.COMPLETED,
            started_at=a_run(()).started_at,
            triggered_by="user",
            scope=RunScope(level="country"),
            failures=(
                AcquisitionFailure(
                    OVERBURDEN, "no", candidate="country.portugal", data_source=DataSourceId("llm")
                ),
            ),
        )
        runs = RecordingRunStore(answers_with=failed)

        await retry_run(
            failed=failed,
            adapters=[PaidPerCandidate(declares=(OVERBURDEN, OVERCROWDING))],
            attributes=BOTH_ATTRIBUTES,
            candidates=BOTH_CANDIDATES,
            values=RecordingValueStore(),
            runs=runs,
            spend_cap_eur=Decimal("5"),
        )

        plan = runs.plans[-1]
        assert plan is not None
        assert plan.estimate_ceiling_eur == Decimal("1.00")

    async def test_the_cap_and_the_acceptance_are_recorded_as_they_stood(self) -> None:
        capped = RecordingRunStore(answers_with=a_finished_run(None))
        uncapped = RecordingRunStore(answers_with=a_finished_run(None))
        paid = PaidPerCandidate(declares=(OVERBURDEN,))

        with_a_cap = await a_sweep(paid, runs=capped, spend_cap_eur=Decimal("5.00"))
        accepted = await a_sweep(paid, runs=uncapped, uncapped_is_accepted=True)

        assert (with_a_cap.spend_cap_eur, with_a_cap.accepted_uncapped) == (Decimal("5.00"), False)
        assert (accepted.spend_cap_eur, accepted.accepted_uncapped) == (None, True)

    async def test_a_free_run_has_a_ceiling_of_nothing(self) -> None:
        runs = RecordingRunStore(answers_with=a_finished_run(None))

        plan = await a_sweep(StubSource("eurostat", declares=(OVERBURDEN,), covers=()), runs=runs)

        assert plan.estimate_ceiling_eur == Decimal(0)

    async def test_a_refused_run_records_no_plan(self) -> None:
        runs = RecordingRunStore(answers_with=a_finished_run(None))

        with pytest.raises(SpendCapNotSetError):
            await a_sweep(PaidPerCandidate(declares=(OVERBURDEN,)), runs=runs)

        assert runs.plans == []
