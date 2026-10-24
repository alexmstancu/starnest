"""What the database holds at a level, read from the database (PL-051, PL-052, PL-054).

The panel and the remedy cards used to read the last acquisition's accounting, so a two-item
retry made the database look like it held two items, and Dismiss made outstanding gaps vanish.
This is the database's own account: the pairs a source can fetch, a stand-in can lend or that
already hold a figure; how many hold a value in use; how old those are; the gaps, each classified
by the latest acquisition that asked about it; and the month's spend over runs **and research**.

Read here rather than in a unit test because every figure is **derived in SQL** from the value,
run and ledger rows. A fake could only return what it was told to.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import ReferencePeriod
from starnest.data_acquisition import AcquisitionFailure, Holdings, RunScope, RunStatus
from starnest.storage import PostgresRunStore, PostgresValueStore

from .test_run_store import (
    NOT_CREDIBLE,
    OVERBURDEN,
    OVERCROWDING,
    a_figure,
    a_spend,
    retrieved_at,
    switched_off,
)

pytestmark = pytest.mark.storage

PORTUGAL = "country.portugal"
SPAIN = "country.spain"
GREECE = "country.greece"
LIECHTENSTEIN = "country.liechtenstein"
BOTH = (OVERBURDEN, OVERCROWDING)
COUNTRIES_IN_THE_CATALOG = 32
MONTH_START = datetime(2026, 10, 1, tzinfo=UTC)


async def holdings(
    pool: AsyncConnectionPool,
    *,
    askable: Sequence[str] = BOTH,
    lent: Sequence[tuple[str, str]] = (),
    since: datetime = MONTH_START,
    refetch_days: int | None = None,
) -> Holdings:
    return await PostgresRunStore(pool).read_holdings(
        level="country",
        askable_attributes=askable,
        stand_in_pairs=lent,
        since=since,
        refetch_older_than_days=refetch_days,
    )


async def a_finished_run(
    pool: AsyncConnectionPool,
    pairs: Sequence[tuple[str, str]],
    *,
    status: RunStatus = RunStatus.COMPLETED,
) -> int:
    """A run over exact pairs, closed as `status` -- one at a time, as the database insists."""
    store = PostgresRunStore(pool)
    run = await store.start_run(
        RunScope(
            level="country",
            candidates=tuple(sorted({candidate for candidate, _ in pairs})),
            attributes=tuple(sorted({attribute for _, attribute in pairs})),
            pairs=tuple(pairs),
        ),
        triggered_by="test",
    )
    if status is RunStatus.HALTED_BY_USER:
        await store.request_stop(run)
    await store.finish_run(run, status=status, finished_at=datetime.now(UTC))
    return run


async def a_failure(
    pool: AsyncConnectionPool, run: int, candidate: str, attribute: str, source: str = "eurostat"
) -> None:
    await PostgresRunStore(pool).record_failures(
        run,
        [AcquisitionFailure(attribute, "declined", candidate=candidate, data_source=source)],
    )


def kinds_of(found: Holdings) -> dict[tuple[str, str], tuple[str, int | None]]:
    """Every gap, keyed by its pair, as (which list, the run it names)."""
    return {
        (gap.candidate, gap.attribute): (kind, gap.data_acquisition_run)
        for kind, gaps in (
            ("failed", found.failed),
            ("unanswered", found.unanswered),
            ("not_reached", found.not_reached),
        )
        for gap in gaps
    }


class TestWhatIsStored:
    async def test_values_stored_counts_pairs_with_an_active_value_at_the_level(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Two sources' figures for one pair are one value in use, so one stored pair."""
        await PostgresValueStore(pool).append(
            [
                a_figure(None, PORTUGAL, OVERBURDEN),
                a_figure(None, PORTUGAL, OVERBURDEN, source="oecd"),
                a_figure(None, SPAIN, OVERCROWDING),
            ]
        )

        found = await holdings(pool)

        assert found.values_stored == 2
        assert found.pairs_total == COUNTRIES_IN_THE_CATALOG * 2

    async def test_a_rejected_or_switched_off_figure_is_not_stored(
        self, pool: AsyncConnectionPool
    ) -> None:
        """A figure that cannot be used is no value in use, whatever rows it left behind."""
        await PostgresValueStore(pool).append(
            [
                a_figure(None, PORTUGAL, OVERBURDEN).model_copy(
                    update={"rejection_reason": NOT_CREDIBLE}
                ),
                a_figure(None, SPAIN, OVERBURDEN, source="oecd"),
            ]
        )

        async with switched_off(pool, "oecd"):
            found = await holdings(pool)

        assert found.values_stored == 0

    async def test_a_pair_holding_a_figure_counts_though_no_source_could_fetch_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Pairs already holding a figure are in the total, so stored never exceeds it."""
        await PostgresValueStore(pool).append([a_figure(None, PORTUGAL, OVERBURDEN)])

        found = await holdings(pool, askable=())

        assert (found.pairs_total, found.values_stored) == (1, 1)

    async def test_a_pair_a_stand_in_can_lend_counts_though_no_source_fetches_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        found = await holdings(pool, askable=(), lent=[(LIECHTENSTEIN, OVERBURDEN)])

        assert found.pairs_total == 1
        assert kinds_of(found) == {(LIECHTENSTEIN, OVERBURDEN): ("not_reached", None)}


async def _the_age_boundary(pool: AsyncConnectionPool) -> tuple[date, date]:
    """The oldest reference end the attribute still calls fresh, and the day before it --
    computed by the database from `max_age`, as the view computes it (KT-A4)."""
    async with pool.connection() as connection:
        cursor = await connection.execute(
            "SELECT (CURRENT_DATE - a.max_age)::date, (CURRENT_DATE - a.max_age)::date - 1"
            " FROM attribute AS a WHERE a.id = %s",
            (OVERBURDEN,),
        )
        fresh_end, stale_end = await cursor.fetchone()
    return fresh_end, stale_end


def ending(end: date, candidate: str) -> object:
    return a_figure(None, candidate, OVERBURDEN).model_copy(
        update={"reference_period": ReferencePeriod(start=end - timedelta(days=364), end=end)}
    )


class TestHowOldItIs:
    async def test_a_value_past_its_attributes_maximum_age_is_counted(
        self, pool: AsyncConnectionPool
    ) -> None:
        """One day past the attribute's maximum age is past it; the boundary day is not."""
        fresh_end, stale_end = await _the_age_boundary(pool)
        await PostgresValueStore(pool).append(
            [ending(fresh_end, PORTUGAL), ending(stale_end, SPAIN)]  # type: ignore[list-item]
        )

        found = await holdings(pool)

        assert (found.values_stored, found.values_past_allowed_age) == (2, 1)

    async def test_the_refetch_figure_is_null_while_the_setting_is_unset(
        self, pool: AsyncConnectionPool
    ) -> None:
        await PostgresValueStore(pool).append([a_figure(None, PORTUGAL, OVERBURDEN)])

        assert (await holdings(pool, refetch_days=None)).values_older_than_refetch_age is None

    async def test_the_refetch_figure_counts_pairs_last_answered_before_the_setting(
        self, pool: AsyncConnectionPool
    ) -> None:
        now = datetime.now(UTC)
        await PostgresValueStore(pool).append(
            [
                retrieved_at(a_figure(None, PORTUGAL, OVERBURDEN), now - timedelta(days=40)),
                retrieved_at(a_figure(None, SPAIN, OVERBURDEN), now - timedelta(days=20)),
                # Re-fetched since: the pair's last answer is recent, so it is not counted.
                retrieved_at(a_figure(None, GREECE, OVERBURDEN), now - timedelta(days=40)),
                retrieved_at(
                    a_figure(None, GREECE, OVERBURDEN, source="oecd"), now - timedelta(days=1)
                ),
            ]
        )

        assert (await holdings(pool, refetch_days=30)).values_older_than_refetch_age == 1


async def _started_at(pool: AsyncConnectionPool, run: int, moment: datetime) -> None:
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE data_acquisition_run SET started_at = %s WHERE id = %s", (moment, run)
        )


async def _researched_at(pool: AsyncConnectionPool, gate: str, moment: datetime) -> None:
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE match_rule_research_spend SET researched_at = %s WHERE match_rule = %s",
            (moment, gate),
        )


class TestThisMonthsSpend:
    """`reqs.md` 3.8: what this month cost is a sum over the runs and the research ledger."""

    async def test_this_months_spend_adds_runs_and_research_from_since(
        self, pool: AsyncConnectionPool
    ) -> None:
        store = PostgresRunStore(pool)
        last_month = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        this_month = await a_finished_run(pool, [(SPAIN, OVERBURDEN)])
        await store.add_spend(last_month, calls=1, cost_eur=Decimal("1.00"))
        await store.add_spend(this_month, calls=1, cost_eur=Decimal("0.30"))
        await _started_at(pool, last_month, MONTH_START - timedelta(seconds=1))
        await _started_at(pool, this_month, MONTH_START)
        await store.record_research_spend(a_spend("li_eea_quota", LIECHTENSTEIN, "2.00"))
        await store.record_research_spend(a_spend("uk_skilled_worker", PORTUGAL, "0.12"))
        await _researched_at(pool, "li_eea_quota", MONTH_START - timedelta(seconds=1))
        await _researched_at(pool, "uk_skilled_worker", MONTH_START)

        spent = (await holdings(pool)).spent

        assert spent.since == MONTH_START
        assert (spent.runs_eur, spent.research_eur) == (Decimal("0.30"), Decimal("0.12"))
        assert spent.total_eur == Decimal("0.42")

    async def test_a_month_with_nothing_spent_is_zero_not_absent(
        self, pool: AsyncConnectionPool
    ) -> None:
        spent = (await holdings(pool)).spent

        assert (spent.runs_eur, spent.research_eur, spent.total_eur) == (0, 0, 0)


class TestTheGaps:
    """D18 refined (C04-N2): a gap is a pair with no value in use, classified by the latest
    acquisition that asked about it -- never by the run somebody has open."""

    async def test_a_pair_answered_after_it_failed_is_no_gap(
        self, pool: AsyncConnectionPool
    ) -> None:
        first = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await a_failure(pool, first, PORTUGAL, OVERBURDEN)
        second = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await PostgresValueStore(pool).append([a_figure(second, PORTUGAL, OVERBURDEN)])

        assert (PORTUGAL, OVERBURDEN) not in kinds_of(await holdings(pool))

    async def test_a_gap_is_classified_by_the_latest_run_that_asked_about_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Not by the newest run overall: a retry over Spain says nothing about Portugal."""
        first = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await a_failure(pool, first, PORTUGAL, OVERBURDEN)
        await a_finished_run(pool, [(SPAIN, OVERBURDEN)])

        assert kinds_of(await holdings(pool))[(PORTUGAL, OVERBURDEN)] == ("failed", first)

    async def test_a_later_run_that_asked_again_decides_the_gap(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Asked again and nobody had a row: it is unanswered now, whatever failed before."""
        first = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await a_failure(pool, first, PORTUGAL, OVERBURDEN)
        second = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])

        assert kinds_of(await holdings(pool))[(PORTUGAL, OVERBURDEN)] == ("unanswered", second)

    async def test_a_failure_where_another_source_answered_is_no_gap(
        self, pool: AsyncConnectionPool
    ) -> None:
        """OECD failed and the estimate answered: nothing is outstanding (C04-N2)."""
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await a_failure(pool, run, PORTUGAL, OVERBURDEN, source="oecd")
        await PostgresValueStore(pool).append([a_figure(run, PORTUGAL, OVERBURDEN)])

        assert (PORTUGAL, OVERBURDEN) not in kinds_of(await holdings(pool))

    async def test_a_rejected_only_figure_is_a_failed_gap(self, pool: AsyncConnectionPool) -> None:
        """Even with no failure row beside it, as a run older than BE-08 left it (NEW-30)."""
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await PostgresValueStore(pool).append(
            [
                a_figure(run, PORTUGAL, OVERBURDEN).model_copy(
                    update={"rejection_reason": NOT_CREDIBLE}
                )
            ]
        )

        (gap,) = [g for g in (await holdings(pool)).failed if g.candidate == PORTUGAL]
        assert gap.data_acquisition_run == run
        assert [(f.data_source, f.reason) for f in gap.failures] == [("eurostat", NOT_CREDIBLE)]

    async def test_a_failed_gap_lists_each_source_once_with_its_failure_first(
        self, pool: AsyncConnectionPool
    ) -> None:
        """BE-08 leaves a failure row and the rejected figure; the row's message is the one."""
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await a_failure(pool, run, PORTUGAL, OVERBURDEN, source="oecd")
        await a_failure(pool, run, PORTUGAL, OVERBURDEN)
        await PostgresValueStore(pool).append(
            [
                a_figure(run, PORTUGAL, OVERBURDEN).model_copy(
                    update={"rejection_reason": NOT_CREDIBLE}
                )
            ]
        )

        (gap,) = [g for g in (await holdings(pool)).failed if g.candidate == PORTUGAL]
        assert [(f.data_source, f.reason) for f in gap.failures] == [
            ("eurostat", "declined"),
            ("oecd", "declined"),
        ]

    async def test_a_figure_from_a_switched_off_source_is_a_failed_gap_that_says_so(
        self, pool: AsyncConnectionPool
    ) -> None:
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])
        await PostgresValueStore(pool).append([a_figure(run, PORTUGAL, OVERBURDEN, source="oecd")])

        async with switched_off(pool, "oecd"):
            found = await holdings(pool)

        (gap,) = [g for g in found.failed if g.candidate == PORTUGAL]
        assert [(f.data_source, f.reason) for f in gap.failures] == [
            ("oecd", "its source is switched off")
        ]

    async def test_an_item_a_completed_run_asked_and_nobody_answered_is_unanswered(
        self, pool: AsyncConnectionPool
    ) -> None:
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)])

        assert kinds_of(await holdings(pool))[(PORTUGAL, OVERBURDEN)] == ("unanswered", run)

    @pytest.mark.parametrize(
        "status", [RunStatus.HALTED_BY_USER, RunStatus.HALTED_ON_SPEND_CAP, RunStatus.FAILED]
    )
    async def test_an_item_a_run_that_did_not_finish_left_unsettled_is_not_reached(
        self, pool: AsyncConnectionPool, status: RunStatus
    ) -> None:
        """With no record of which sources finished, only a completed run can say nobody had a
        row (C04-N6's fallback): a halted one may simply never have got there."""
        run = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN)], status=status)

        assert kinds_of(await holdings(pool))[(PORTUGAL, OVERBURDEN)] == ("not_reached", run)

    async def test_a_pair_no_run_ever_asked_is_not_reached_with_no_run(
        self, pool: AsyncConnectionPool
    ) -> None:
        assert kinds_of(await holdings(pool))[(GREECE, OVERCROWDING)] == ("not_reached", None)


class TestTheFiguresAddUp:
    """The guard (map-C04 2.3): stored plus the three gap lists is the total, every pair once."""

    async def test_stored_and_gaps_sum_to_the_pairs_total(self, pool: AsyncConnectionPool) -> None:
        values = PostgresValueStore(pool)
        failed = await a_finished_run(pool, [(PORTUGAL, OVERBURDEN), (PORTUGAL, OVERCROWDING)])
        await a_failure(pool, failed, PORTUGAL, OVERBURDEN)
        await values.append([a_figure(failed, PORTUGAL, OVERCROWDING)])
        await values.append(
            [a_figure(None, SPAIN, OVERBURDEN), a_figure(None, SPAIN, OVERBURDEN, source="oecd")]
        )
        halted = await a_finished_run(pool, [(GREECE, OVERBURDEN)], status=RunStatus.HALTED_BY_USER)
        await a_finished_run(pool, [(GREECE, OVERCROWDING)])

        found = await holdings(pool, lent=[(LIECHTENSTEIN, OVERBURDEN)])
        gaps = [*found.failed, *found.unanswered, *found.not_reached]
        pairs = [(gap.candidate, gap.attribute) for gap in gaps]

        assert found.values_stored + len(gaps) == found.pairs_total == COUNTRIES_IN_THE_CATALOG * 2
        assert len(pairs) == len(set(pairs))
        assert {(PORTUGAL, OVERCROWDING), (SPAIN, OVERBURDEN)}.isdisjoint(pairs)
        assert (len(found.failed), len(found.unanswered)) == (1, 1)
        assert kinds_of(found)[(GREECE, OVERBURDEN)] == ("not_reached", halted)
