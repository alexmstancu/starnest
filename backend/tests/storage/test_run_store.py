"""What the run store refuses to write (`0461`), and how it accounts for a run (Q217).

A failure is the unit a retry addresses: one source, asked about one candidate's attribute. One
arriving without a candidate or a source cannot be retried, and storing it against a guessed
candidate would be inventing a fact about a place.

The counts are read here rather than in a unit test because they are **derived in SQL** from the
scope, the value rows and the failure rows. A fake store could only return whatever a fake was
told to; what is under test is the derivation itself.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate, CandidateId
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    DataSourceId,
    MatchRuleId,
    Ratio,
    RatioParameters,
    ReferencePeriod,
    StandIn,
    Value,
    ValueType,
)
from starnest.data_acquisition import (
    STAND_IN,
    Acquired,
    AcquisitionFailure,
    CostMeter,
    OpenedRun,
    ResearchSpend,
    RunAlreadyInFlightError,
    RunPlan,
    RunScope,
    RunStatus,
    SourceAdapter,
    acquire,
    continue_run,
)
from starnest.storage import PostgresCatalogStore, PostgresRunStore, PostgresValueStore

pytestmark = pytest.mark.storage

OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"


@pytest.fixture
async def a_run(pool: AsyncConnectionPool) -> int:
    return await PostgresRunStore(pool).start_run(
        RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,)),
        triggered_by="test",
    )


class TestOnlyOneRunIsRunningAtOnce:
    """Enforced by the database, not by a read (reqs.md 10, ST-01). The `0498` partial unique
    index makes a second concurrent open impossible, so the race's loser gets a clean refusal
    rather than two running runs or a 500 -- the guarantee the API's check-then-insert could
    only narrow."""

    async def test_a_second_running_run_cannot_be_opened(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        with pytest.raises(RunAlreadyInFlightError):
            await PostgresRunStore(pool).start_run(
                RunScope(
                    level="country", candidates=("country.spain",), attributes=(OVERCROWDING,)
                ),
                triggered_by="the second",
            )

    async def test_a_new_run_opens_once_the_first_has_finished(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """One at a time is a limit of one, not of none: finishing the first frees the slot."""
        store = PostgresRunStore(pool)
        await store.finish_run(a_run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC))

        second = await store.start_run(
            RunScope(level="country", candidates=("country.spain",), attributes=(OVERCROWDING,)),
            triggered_by="the second",
        )

        assert second != a_run


@pytest.mark.parametrize(
    "failure",
    [
        AcquisitionFailure(OVERBURDEN, "unreachable", candidate=None, data_source="eurostat"),
        AcquisitionFailure(OVERBURDEN, "declined", candidate="country.portugal"),
    ],
    ids=["no candidate", "no source"],
)
async def test_a_failure_that_names_no_candidate_or_no_source_is_refused(
    pool: AsyncConnectionPool, a_run: int, failure: AcquisitionFailure
) -> None:
    with pytest.raises(ValueError, match="so none can be retried"):
        await PostgresRunStore(pool).record_failures(a_run, [failure])


async def test_two_sources_failing_on_one_item_are_two_failures(
    pool: AsyncConnectionPool, a_run: int
) -> None:
    """Before `0461` the second overwrote the first's message, and which source had failed
    was lost."""
    store = PostgresRunStore(pool)

    await store.record_failures(
        a_run,
        [
            AcquisitionFailure(OVERBURDEN, "403", candidate="country.portugal", data_source="oecd"),
            AcquisitionFailure(
                OVERBURDEN, "no figure", candidate="country.portugal", data_source="eurostat"
            ),
        ],
    )

    failures = (await store.read_run(a_run)).failures
    assert {(f.data_source, f.reason) for f in failures} == {
        ("oecd", "403"),
        ("eurostat", "no figure"),
    }


class TestWhatNobodyAnswered:
    """The third count, derived rather than stored (`reqs.md` Q217).

    A pair the scope names, with no value row and no failure row, is an item every source asked
    answered without having anything for that candidate. Before this it belonged to none of the
    counts, and a run that learned nothing reported that nothing had failed.
    """

    @pytest.fixture
    async def a_wider_run(self, pool: AsyncConnectionPool) -> int:
        """A completed run with no recorded plan: every source it had was asked, so an empty item
        is unanswered (C04-N6's fallback). A run still going would read it "not reached"."""
        return await a_completed_run(
            pool,
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
        )

    async def test_the_three_counts_sum_to_the_total(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [a_figure(a_wider_run, "country.portugal", OVERBURDEN)]
        )
        await store.record_failures(
            a_wider_run,
            [
                AcquisitionFailure(
                    OVERCROWDING,
                    "declined",
                    candidate="country.portugal",
                    data_source="eurostat",
                )
            ],
        )

        run = await store.read_run(a_wider_run)

        assert run.items_total == 4
        assert run.items_completed == 1
        assert run.items_failed == 1
        assert run.items_unanswered == 2
        assert run.items_completed + run.items_failed + run.items_unanswered == run.items_total

    async def test_it_names_the_pairs_so_they_can_be_asked_again(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [a_figure(a_wider_run, "country.portugal", OVERBURDEN)]
        )

        run = await store.read_run(a_wider_run)

        assert [(item.candidate, item.attribute) for item in run.unanswered] == [
            ("country.liechtenstein", OVERBURDEN),
            ("country.liechtenstein", OVERCROWDING),
            ("country.portugal", OVERCROWDING),
        ]

    async def test_an_item_that_failed_is_not_also_unanswered(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        """The two never overlap: a source that broke is a different fact from a source that had
        nothing, and counting one item as both would double it."""
        store = PostgresRunStore(pool)
        await store.record_failures(
            a_wider_run,
            [
                AcquisitionFailure(
                    OVERBURDEN, "403", candidate="country.liechtenstein", data_source="eurostat"
                )
            ],
        )

        run = await store.read_run(a_wider_run)

        assert ("country.liechtenstein", OVERBURDEN) not in [
            (item.candidate, item.attribute) for item in run.unanswered
        ]
        assert run.items_unanswered == 3

    async def test_another_run_s_figure_does_not_fill_this_run_s_gap(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        """A stored figure answers the run that fetched it. Without the run in the condition,
        every gap would be hidden by whatever an earlier run happened to store.

        **This run finished before the next one started**, because one household runs one pass at
        a time (ST-01, `0498`): "another run" is necessarily a different, non-overlapping run, and
        its figure must still not retroactively fill this one's gaps.
        """
        store = PostgresRunStore(pool)
        earlier = await store.start_run(
            RunScope(
                level="country", candidates=("country.liechtenstein",), attributes=(OVERBURDEN,)
            ),
            triggered_by="test",
        )
        await PostgresValueStore(pool).append(
            [a_figure(earlier, "country.liechtenstein", OVERBURDEN)]
        )

        run = await store.read_run(a_wider_run)

        assert run.items_unanswered == 4
        assert run.items_completed == 0

    async def test_a_run_whose_every_item_answered_has_nothing_unanswered(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        await PostgresValueStore(pool).append([a_figure(a_run, "country.portugal", OVERBURDEN)])

        run = await PostgresRunStore(pool).read_run(a_run)

        assert run.items_unanswered == 0
        assert run.unanswered == ()

    async def test_a_re_confirmed_pair_counts_completed_not_unanswered(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        """ST-09. A source re-confirmed a figure already on record -- a transcribed table re-read
        as the same observation -- so the run stored no new row but did answer the pair. It
        counts completed, drops out of the list of items to ask again, and the three counts still
        sum to the total."""
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).record_reuse(
            a_wider_run, "eurostat", {("country.portugal", OVERBURDEN): None}
        )

        run = await store.read_run(a_wider_run)

        assert run.items_completed == 1
        assert run.items_unanswered == 3
        assert ("country.portugal", OVERBURDEN) not in [
            (item.candidate, item.attribute) for item in run.unanswered
        ]
        assert run.items_completed + run.items_failed + run.items_unanswered == run.items_total

    async def test_a_re_confirmed_pair_is_counted_once_even_if_recorded_twice(
        self, pool: AsyncConnectionPool, a_wider_run: int
    ) -> None:
        """Idempotent per run: a retry re-reading the same table records the pair again, and the
        primary key keeps it one row, so the count does not drift."""
        values = PostgresValueStore(pool)
        await values.record_reuse(a_wider_run, "eurostat", {("country.portugal", OVERBURDEN): None})
        await values.record_reuse(a_wider_run, "eurostat", {("country.portugal", OVERBURDEN): None})

        run = await PostgresRunStore(pool).read_run(a_wider_run)

        assert run.items_completed == 1

    @pytest.mark.parametrize(
        ("first_batch", "second_batch", "named"),
        [
            ("older", "newer", None),
            ("older", None, None),
            (None, "older", None),
            ("older", "older", "older"),
        ],
        ids=["two-rows", "a-row-then-unknown", "unknown-then-a-row", "one-row-twice"],
    )
    async def test_a_pair_re_confirmed_in_two_batches_names_a_figure_only_if_both_did(
        self,
        pool: AsyncConnectionPool,
        a_wider_run: int,
        first_batch: str | None,
        second_batch: str | None,
        named: str | None,
    ) -> None:
        """PL-049. One batch restating two rows for a pair names neither, so splitting the same
        input over two batches must too: keeping the first id would vouch for a figure the run
        cannot tell apart from the other."""
        values = PostgresValueStore(pool)
        rows = await two_rows_for_portugals_overburden(values)
        for batch in (first_batch, second_batch):
            restated = rows[batch] if batch else None
            await values.record_reuse(
                a_wider_run, "eurostat", {("country.portugal", OVERBURDEN): restated}
            )

        run = await PostgresRunStore(pool).read_run(a_wider_run)

        assert [item.value for item in run.reconfirmed] == [rows[named] if named else None]

    async def test_two_batches_racing_with_two_rows_name_neither(
        self, pool: AsyncConnectionPool, a_wider_run: int, database_url: str
    ) -> None:
        """The second batch's write waits on the first's uncommitted row and must still merge
        with it once it commits, rather than keep whichever landed first."""
        values = PostgresValueStore(pool)
        rows = await two_rows_for_portugals_overburden(values)
        async with await psycopg.AsyncConnection.connect(database_url) as first_batch:
            await first_batch.execute(
                "INSERT INTO data_acquisition_run_reuse "
                "(data_acquisition_run, data_source, candidate, attribute, value) "
                "VALUES (%s, 'eurostat', 'country.portugal', %s, %s)",
                (a_wider_run, OVERBURDEN, rows["older"]),
            )
            second_batch = asyncio.create_task(
                values.record_reuse(
                    a_wider_run, "eurostat", {("country.portugal", OVERBURDEN): rows["newer"]}
                )
            )
            waited = await a_write_waits_on_a_lock(database_url)
            await first_batch.commit()
            await asyncio.wait_for(second_batch, PATIENCE_SECONDS)

        run = await PostgresRunStore(pool).read_run(a_wider_run)

        assert waited, "the second batch never waited for the first, so this proves nothing"
        assert [item.value for item in run.reconfirmed] == [None]


PATIENCE_SECONDS = 10


async def two_rows_for_portugals_overburden(values: PostgresValueStore) -> dict[str, int]:
    """Two stored rows from one source for one pair: two transcriptions, a year apart."""
    older = a_figure(None, "country.portugal", OVERBURDEN)
    newer = older.model_copy(update={"retrieval_date": older.retrieval_date + timedelta(days=365)})
    stored = await values.append([older, newer])
    return {"older": int(stored[0].id), "newer": int(stored[1].id)}


async def a_write_waits_on_a_lock(database_url: str) -> bool:
    """Whether a statement on this database comes to wait for a lock it was not granted."""
    async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as observer:
        for _ in range(PATIENCE_SECONDS * 50):
            row = await (
                await observer.execute(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                    "WHERE datname = current_database() AND wait_event_type = 'Lock')"
                )
            ).fetchone()
            if row is not None and row[0]:
                return True
            await asyncio.sleep(0.02)
    return False


class TestARunScopedToExactPairs:
    """BE-11. A retry asks about specific (candidate, attribute) pairs, not the rectangle its two
    scope lists span. When the run names its pairs, the item counts are those pairs -- so a corner
    no source was asked about is never a phantom `unanswered` item that asking again can never
    close."""

    @pytest.fixture
    async def a_retry_of_two_pairs(self, pool: AsyncConnectionPool) -> int:
        # The two lists span four corners; the run asks about only two of them.
        return await a_completed_run(
            pool,
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
                pairs=(
                    ("country.portugal", OVERBURDEN),
                    ("country.liechtenstein", OVERCROWDING),
                ),
            ),
        )

    async def test_the_total_is_the_pairs_not_the_rectangle(
        self, pool: AsyncConnectionPool, a_retry_of_two_pairs: int
    ) -> None:
        run = await PostgresRunStore(pool).read_run(a_retry_of_two_pairs)

        assert run.items_total == 2

    async def test_only_the_pairs_it_asked_are_listed_re_confirmed(
        self, pool: AsyncConnectionPool, a_retry_of_two_pairs: int
    ) -> None:
        """FU-A1, PL-049. A re-confirmation stamped with the run for a pair it never asked about
        is not something the run produced, so the diff must not be handed it."""
        await PostgresValueStore(pool).record_reuse(
            a_retry_of_two_pairs,
            "eurostat",
            {("country.portugal", OVERBURDEN): None, ("country.portugal", OVERCROWDING): None},
        )

        run = await PostgresRunStore(pool).read_run(a_retry_of_two_pairs)

        assert [(item.candidate, item.attribute) for item in run.reconfirmed] == [
            ("country.portugal", OVERBURDEN)
        ]

    async def test_the_values_it_re_confirmed_are_exactly_the_ones_it_lists(
        self, pool: AsyncConnectionPool, a_retry_of_two_pairs: int
    ) -> None:
        """PL-049. The diff reads the figures through `reconfirmed_by_run`, so a value named for
        a pair the run never asked about must not reach it by that road either."""
        values = PostgresValueStore(pool)
        (asked, not_asked) = await values.append(
            [
                a_figure(None, "country.portugal", OVERBURDEN),
                a_figure(None, "country.portugal", OVERCROWDING),
            ]
        )
        await values.record_reuse(
            a_retry_of_two_pairs,
            "eurostat",
            {
                ("country.portugal", OVERBURDEN): asked.id,
                ("country.portugal", OVERCROWDING): not_asked.id,
            },
        )

        run = await PostgresRunStore(pool).read_run(a_retry_of_two_pairs)
        listed = await values.read_values(reconfirmed_by_run=a_retry_of_two_pairs)
        total = await values.count_values(reconfirmed_by_run=a_retry_of_two_pairs)

        assert [item.value for item in run.reconfirmed] == [asked.id]
        assert [listing.value.id for listing in listed] == [asked.id]
        assert total == 1

    async def test_only_the_pairs_it_asked_are_counted_or_listed_unanswered(
        self, pool: AsyncConnectionPool, a_retry_of_two_pairs: int
    ) -> None:
        """One of the two pairs is answered; the other is unanswered. The two off-corners --
        (Portugal, overcrowding) and (Liechtenstein, overburden) -- are neither, because no source
        was asked about them."""
        await PostgresValueStore(pool).append(
            [a_figure(a_retry_of_two_pairs, "country.portugal", OVERBURDEN)]
        )

        run = await PostgresRunStore(pool).read_run(a_retry_of_two_pairs)

        assert run.items_completed == 1
        assert run.items_unanswered == 1
        assert [(item.candidate, item.attribute) for item in run.unanswered] == [
            ("country.liechtenstein", OVERCROWDING)
        ]
        assert run.items_completed + run.items_failed + run.items_unanswered == run.items_total


async def a_completed_run(pool: AsyncConnectionPool, scope: RunScope) -> int:
    """A run opened the old way, with no plan, and closed `completed`: its empty items read
    unanswered by the status rule (C04-N6), whatever is written for it afterwards."""
    runs = PostgresRunStore(pool)
    run = await runs.start_run(scope, triggered_by="test")
    await runs.finish_run(run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC))
    return run


def a_figure(run: int | None, candidate: str, attribute: str, source: str = "eurostat") -> Value:
    """One stored figure, with the provenance every value carries and nothing incidental."""
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source=source,
        reference_period=ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31)),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("6.3"), basis="households"),
        data_acquisition_run=run,
    )


NOT_CREDIBLE = f"96.3 is outside the credible range 0 to 60 declared for {OVERBURDEN}"


def a_rejected_figure(
    run: int, candidate: str, source: str = "eurostat"
) -> tuple[Value, AcquisitionFailure]:
    """A figure stored with its attribute's verdict against it, and the failure the run records
    beside it (BE-08) -- the two rows a rejection at acquisition leaves. A run older than BE-08
    left only the first (NEW-30)."""
    return (
        a_figure(run, candidate, OVERBURDEN, source=source).model_copy(
            update={"rejection_reason": NOT_CREDIBLE}
        ),
        AcquisitionFailure(
            OVERBURDEN,
            f"the figure was stored and rejected: {NOT_CREDIBLE}",
            candidate=candidate,
            data_source=source,
        ),
    )


DATED_TODAY = "Dated as the day it was fetched rather than the period it describes (P37)"


async def reject_after_its_run(
    pool: AsyncConnectionPool, run: int, candidate: str, attribute: str
) -> None:
    """Reject a stored figure after its run, as `0473` rejected 156 LLM figures: an UPDATE on
    the value row and nothing else, so no failure row ever stands beside it."""
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE value SET rejection_reason = %s"
            " WHERE data_acquisition_run = %s AND candidate = %s AND attribute = %s",
            (DATED_TODAY, run, candidate, attribute),
        )


async def reach_of(pool: AsyncConnectionPool, run: int) -> dict[str, tuple[int, int]]:
    """Each source's `(items_stored, items_failed)` for one run."""
    return {
        r.data_source: (r.items_stored, r.items_failed)
        for r in (await PostgresRunStore(pool).read_run(run)).by_source
    }


class TestWhichSourceGotItThere:
    """Source by source: what each stored, and what each failed on.

    A run's totals say how far it got. They do not say which source got it there, which is the
    question behind every retry -- and the one a reader asks first when a run half-filled.
    """

    @pytest.fixture
    async def a_two_source_run(self, pool: AsyncConnectionPool) -> int:
        return await PostgresRunStore(pool).start_run(
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
            triggered_by="test",
        )

    async def test_each_source_reports_what_it_stored(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [
                a_figure(a_two_source_run, "country.portugal", OVERBURDEN, source="eurostat"),
                a_figure(a_two_source_run, "country.portugal", OVERCROWDING, source="eurostat"),
                a_figure(a_two_source_run, "country.liechtenstein", OVERBURDEN, source="oecd"),
            ]
        )

        reach = {
            r.data_source: r.items_stored
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": 2, "oecd": 1}

    async def test_a_source_that_only_failed_still_appears(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """A breakdown that lists only the sources that worked is not a breakdown: the source a
        reader came here to find is precisely the one that answered nothing."""
        store = PostgresRunStore(pool)
        await store.record_failures(
            a_two_source_run,
            [
                AcquisitionFailure(
                    OVERBURDEN, "403", candidate="country.portugal", data_source="oecd"
                )
            ],
        )

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"oecd": (0, 1)}

    async def test_one_source_failing_where_another_answered_reports_both(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """The two counts are independent on purpose. OECD failed on the item and Eurostat
        answered it; the run counts it complete, and OECD's failure is still worth retrying."""
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [a_figure(a_two_source_run, "country.portugal", OVERBURDEN, source="eurostat")]
        )
        await store.record_failures(
            a_two_source_run,
            [
                AcquisitionFailure(
                    OVERBURDEN, "403", candidate="country.portugal", data_source="oecd"
                )
            ],
        )

        run = await store.read_run(a_two_source_run)

        assert run.items_completed == 1
        assert {r.data_source: (r.items_stored, r.items_failed) for r in run.by_source} == {
            "eurostat": (1, 0),
            "oecd": (0, 1),
        }

    async def test_a_run_that_reached_nobody_has_an_empty_breakdown(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        assert (await PostgresRunStore(pool).read_run(a_two_source_run)).by_source == ()

    # **A figure read again is credited to the source that read it** (NEW-54). ST-09 counts a
    # re-confirmed pair completed in the run's totals; without its source, the breakdown could
    # credit nobody, and a run that only re-read transcribed tables showed every pair answered
    # beside a breakdown with no source in it.

    async def test_a_source_that_only_re_confirmed_a_figure_is_listed_with_it_stored(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).record_reuse(
            a_two_source_run, "eurostat", {("country.portugal", OVERBURDEN): None}
        )

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": (1, 0)}

    async def test_a_re_confirmed_figure_is_credited_to_the_source_that_re_read_it(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [a_figure(a_two_source_run, "country.portugal", OVERBURDEN, source="eurostat")]
        )
        await PostgresValueStore(pool).record_reuse(
            a_two_source_run, "oecd", {("country.liechtenstein", OVERBURDEN): None}
        )

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": (1, 0), "oecd": (1, 0)}

    async def test_a_new_figure_and_a_re_confirmed_one_from_one_source_count_two(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).append(
            [a_figure(a_two_source_run, "country.portugal", OVERBURDEN, source="eurostat")]
        )
        await PostgresValueStore(pool).record_reuse(
            a_two_source_run, "eurostat", {("country.portugal", OVERCROWDING): None}
        )

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": (2, 0)}

    async def test_a_re_read_figure_its_source_rejected_is_a_failure_not_also_stored(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """A rejected figure re-read is still rejected, and BE-08 records it as its source's
        failure. Credited as re-confirmed as well, one pair would read stored and failed at
        once -- the double count `85d545d` took out of the breakdown."""
        store = PostgresRunStore(pool)
        await PostgresValueStore(pool).record_reuse(
            a_two_source_run, "eurostat", {("country.portugal", OVERBURDEN): None}
        )
        await store.record_failures(
            a_two_source_run,
            [
                AcquisitionFailure(
                    OVERBURDEN,
                    "the figure was stored and rejected: out of range",
                    candidate="country.portugal",
                    data_source="eurostat",
                )
            ],
        )

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": (0, 1)}

    async def test_a_rejected_figure_counts_for_its_source_as_a_failure_not_as_stored(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """BE-08 made a rejected figure a failure a retry can reach, and its value row still
        counted as stored -- one pair both stored and failed, so a bar summing the two read 32
        of 33 for a source asked 32 items. A rejected figure contributed nothing."""
        store = PostgresRunStore(pool)
        rejected, its_failure = a_rejected_figure(a_two_source_run, "country.liechtenstein")
        await PostgresValueStore(pool).append(
            [
                a_figure(a_two_source_run, "country.portugal", OVERBURDEN),
                a_figure(a_two_source_run, "country.portugal", OVERCROWDING),
                rejected,
            ]
        )
        await store.record_failures(a_two_source_run, [its_failure])

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"eurostat": (2, 1)}

    async def test_a_source_whose_only_figure_was_rejected_is_listed_as_having_failed(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """Drawn as barren, as it is: it was asked, it answered, and nothing it said can be
        used. Still listed, because the source a reader came looking for is that one."""
        store = PostgresRunStore(pool)
        rejected, its_failure = a_rejected_figure(
            a_two_source_run, "country.portugal", source="oecd"
        )
        await PostgresValueStore(pool).append([rejected])
        await store.record_failures(a_two_source_run, [its_failure])

        reach = {
            r.data_source: (r.items_stored, r.items_failed)
            for r in (await store.read_run(a_two_source_run)).by_source
        }

        assert reach == {"oecd": (0, 1)}

    async def test_a_figure_rejected_after_its_run_counts_for_its_source_as_failed(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """NEW-30. `0473` rejected 156 LLM figures long after their runs, and no failure row
        stands beside any of them. Counted from failure rows alone each pair belonged to neither
        count, so `llm` read 0 and 0 -- and a screen dropping a source that touched nothing
        dropped it from the very runs it answered. Eurostat keeps only its own figure."""
        await PostgresValueStore(pool).append(
            [
                a_figure(a_two_source_run, "country.portugal", OVERBURDEN, source="eurostat"),
                a_figure(a_two_source_run, "country.liechtenstein", OVERBURDEN, source="llm"),
            ]
        )
        await reject_after_its_run(pool, a_two_source_run, "country.liechtenstein", OVERBURDEN)

        assert await reach_of(pool, a_two_source_run) == {"eurostat": (1, 0), "llm": (0, 1)}

    async def test_a_source_with_one_accepted_and_one_rejected_figure_reads_one_of_each(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """A run older than BE-08 stored its rejected figure and wrote no failure beside it. It
        reads as a run made today does: the rejection is on the value row either way."""
        rejected, _never_recorded = a_rejected_figure(a_two_source_run, "country.liechtenstein")
        await PostgresValueStore(pool).append(
            [a_figure(a_two_source_run, "country.portugal", OVERBURDEN), rejected]
        )

        assert await reach_of(pool, a_two_source_run) == {"eurostat": (1, 1)}

    async def test_a_rejected_figure_and_its_failure_row_are_one_failed_item(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """Counted once, not twice: since BE-08 a rejection leaves a value row and a failure row
        for one pair. Beside it, a plain fetch failure has only the failure row, and counts."""
        store = PostgresRunStore(pool)
        rejected, its_failure = a_rejected_figure(a_two_source_run, "country.liechtenstein")
        await PostgresValueStore(pool).append([rejected])
        await store.record_failures(
            a_two_source_run,
            [
                its_failure,
                AcquisitionFailure(
                    OVERCROWDING, "503", candidate="country.portugal", data_source="eurostat"
                ),
            ],
        )

        assert await reach_of(pool, a_two_source_run) == {"eurostat": (0, 2)}

    async def test_a_figure_rejected_in_another_run_is_not_this_runs_failure(
        self, pool: AsyncConnectionPool, a_two_source_run: int
    ) -> None:
        """The rejection is read from this run's value rows only. A later run answering the
        same pair from the same source owes nothing to the earlier one's rejected figure."""
        store = PostgresRunStore(pool)
        values = PostgresValueStore(pool)
        await values.append([a_figure(a_two_source_run, "country.portugal", OVERBURDEN)])
        await reject_after_its_run(pool, a_two_source_run, "country.portugal", OVERBURDEN)
        await store.finish_run(
            a_two_source_run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC)
        )
        later = await store.start_run(
            RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,)),
            triggered_by="test",
        )
        await values.append([a_figure(later, "country.portugal", OVERBURDEN)])

        assert await reach_of(pool, later) == {"eurostat": (1, 0)}
        assert await reach_of(pool, a_two_source_run) == {"eurostat": (0, 1)}


class TestARunCountsOnlyItsOwnItems:
    """FU-A1 (PL-042). Every value, re-confirmation and failure stamped with a run counted toward
    it, whether or not it named a pair the run had asked about. A retry's borrow written outside
    its pairs then made it read "3 of 2" -- more answered than it had items.

    A row outside the run's items is evidence the run should never have written, not progress.
    Nothing in the schema forbids one yet, so the fixture writes them directly: one of each kind
    from the source that also has the run's real answers, each on its own pair so no row can mask
    another, and three from a source with nothing inside the items at all.
    """

    @pytest.fixture
    async def a_run_with_rows_outside_its_items(self, pool: AsyncConnectionPool) -> int:
        runs, values = PostgresRunStore(pool), PostgresValueStore(pool)
        run = await runs.start_run(
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
                pairs=(("country.portugal", OVERBURDEN), ("country.liechtenstein", OVERCROWDING)),
            ),
            triggered_by="test",
        )
        await values.append(
            [
                a_figure(run, "country.portugal", OVERBURDEN),
                a_figure(run, "country.spain", OVERBURDEN),
                a_figure(run, "country.spain", OVERCROWDING).model_copy(
                    update={"rejection_reason": NOT_CREDIBLE}
                ),
                a_figure(run, "country.liechtenstein", OVERBURDEN, source="stand_in"),
            ]
        )
        await values.record_reuse(run, "eurostat", {("country.greece", OVERBURDEN): None})
        await values.record_reuse(run, "stand_in", {("country.portugal", OVERCROWDING): None})
        await runs.record_failures(
            run,
            [
                AcquisitionFailure(
                    OVERCROWDING, "403", candidate="country.liechtenstein", data_source="eurostat"
                ),
                AcquisitionFailure(
                    OVERCROWDING, "403", candidate="country.greece", data_source="eurostat"
                ),
                AcquisitionFailure(
                    OVERBURDEN, "no figure", candidate="country.italy", data_source="stand_in"
                ),
            ],
        )
        return run

    async def test_the_detail_counts_only_its_items(
        self, pool: AsyncConnectionPool, a_run_with_rows_outside_its_items: int
    ) -> None:
        run = await PostgresRunStore(pool).read_run(a_run_with_rows_outside_its_items)

        assert (
            run.items_total,
            run.items_completed,
            run.items_failed,
            run.items_unanswered,
        ) == (2, 1, 1, 0)

    async def test_the_detail_lists_only_its_items(
        self, pool: AsyncConnectionPool, a_run_with_rows_outside_its_items: int
    ) -> None:
        """The lists are read from the same items as the counts (ST-11). Greece and Italy were
        never asked about, so their failures are not this run's to list -- nor, since the list
        is a retry's scope, to send a retry back to."""
        run = await PostgresRunStore(pool).read_run(a_run_with_rows_outside_its_items)

        assert [(f.data_source, f.candidate, f.attribute) for f in run.failures] == [
            ("eurostat", "country.liechtenstein", OVERCROWDING)
        ]
        assert run.unanswered == ()

    async def test_the_history_row_counts_only_its_items(
        self, pool: AsyncConnectionPool, a_run_with_rows_outside_its_items: int
    ) -> None:
        (row,) = [
            run
            for run in await PostgresRunStore(pool).read_runs()
            if run.id == a_run_with_rows_outside_its_items
        ]

        assert (
            row.items_total,
            row.items_completed,
            row.items_failed,
            row.items_unanswered,
        ) == (2, 1, 1, 0)

    async def test_each_source_is_credited_only_with_its_items(
        self, pool: AsyncConnectionPool, a_run_with_rows_outside_its_items: int
    ) -> None:
        """Eurostat stored one item and failed on one; everything else it wrote lies outside.
        The stand-in source wrote nothing inside the items, so it did not reach this run."""
        assert await reach_of(pool, a_run_with_rows_outside_its_items) == {"eurostat": (1, 1)}


class CommitsMidRead:
    """The store's own queries, with another process's write committed the moment `select_run`
    returns -- before any statement the same read might run after it."""

    def __init__(self, queries: Any, write: Callable[[], Awaitable[object]]) -> None:
        self._queries = queries
        self._write = write
        self._written = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._queries, name)

    async def select_run(self, connection: Any, **asked: Any) -> Any:
        row = await self._queries.select_run(connection, **asked)
        if not self._written:
            self._written = True
            await self._write()
        return row


@pytest.fixture
async def another_process(database_url: str) -> AsyncIterator[AsyncConnectionPool]:
    """A second backend on the same database -- the docker one beside `make serve` -- holding
    the one connection production gives each process (NEW-21)."""
    async with AsyncConnectionPool(database_url, min_size=1, max_size=1, open=False) as other:
        await other.open(wait=True)
        yield other


class TestOnePollIsOneSnapshot:
    """ST-11 (PL-044). A screen polls a run every two seconds while the run writes, and one poll
    must be one picture: its counts and its lists taken at the same moment.

    Read as four statements under READ COMMITTED, each took its own snapshot, so a commit landing
    between them split a count from its list -- two unanswered beside a list of one. One
    connection per process hid it (NEW-21); a second process on the same database does not.
    Here that process commits the moment the first statement returns, the widest gap a read made
    of several statements can leave.
    """

    @pytest.fixture
    async def a_run_half_answered(self, pool: AsyncConnectionPool) -> int:
        """Four items of a completed run: Portugal's overburden answered, its overcrowding failed,
        and both of Liechtenstein's unanswered."""
        runs = PostgresRunStore(pool)
        run = await a_completed_run(
            pool,
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
        )
        await PostgresValueStore(pool).append([a_figure(run, "country.portugal", OVERBURDEN)])
        await runs.record_failures(
            run,
            [
                AcquisitionFailure(
                    OVERCROWDING, "503", candidate="country.portugal", data_source="eurostat"
                )
            ],
        )
        return run

    async def test_a_failure_landing_mid_read_cannot_split_a_count_from_its_list(
        self,
        pool: AsyncConnectionPool,
        another_process: AsyncConnectionPool,
        a_run_half_answered: int,
    ) -> None:
        store = PostgresRunStore(pool)
        store._queries = CommitsMidRead(
            store._queries,
            write=lambda: PostgresRunStore(another_process).record_failures(
                a_run_half_answered,
                [
                    AcquisitionFailure(
                        OVERBURDEN, "403", candidate="country.liechtenstein", data_source="eurostat"
                    )
                ],
            ),
        )

        run = await store.read_run(a_run_half_answered)

        assert len(run.unanswered) == run.items_unanswered
        # No source failed on an answered item here, so each pair listed is one failed item.
        assert len({(f.candidate, f.attribute) for f in run.failures}) == run.items_failed
        assert run.items_completed + run.items_failed + run.items_unanswered == run.items_total

    async def test_a_figure_landing_mid_read_cannot_split_the_totals_from_the_breakdown(
        self,
        pool: AsyncConnectionPool,
        another_process: AsyncConnectionPool,
        a_run_half_answered: int,
    ) -> None:
        store = PostgresRunStore(pool)
        store._queries = CommitsMidRead(
            store._queries,
            write=lambda: PostgresValueStore(another_process).append(
                [a_figure(a_run_half_answered, "country.liechtenstein", OVERBURDEN)]
            ),
        )

        run = await store.read_run(a_run_half_answered)

        # Eurostat is the only source that answered anything, so what it stored is what completed.
        assert {r.data_source: r.items_stored for r in run.by_source} == {
            "eurostat": run.items_completed
        }
        assert len(run.unanswered) == run.items_unanswered

    async def test_each_list_keeps_the_order_its_own_query_gave_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Folded into one statement, the lists are still ordered, and as before: the failures by
        pair then source, the unanswered by pair, the sources by name. The items and failures are
        written in the reverse of each order, so arriving as written is not arriving in order."""
        runs = PostgresRunStore(pool)
        run = await a_completed_run(
            pool,
            RunScope(
                level="country",
                candidates=("country.portugal", "country.liechtenstein"),
                attributes=(OVERCROWDING, OVERBURDEN),
                pairs=(
                    ("country.portugal", OVERCROWDING),
                    ("country.portugal", OVERBURDEN),
                    ("country.liechtenstein", OVERCROWDING),
                    ("country.liechtenstein", OVERBURDEN),
                ),
            ),
        )
        await runs.record_failures(
            run,
            [
                AcquisitionFailure(
                    OVERCROWDING, "503", candidate="country.portugal", data_source="world_bank"
                ),
                AcquisitionFailure(
                    OVERCROWDING, "503", candidate="country.portugal", data_source="eurostat"
                ),
                AcquisitionFailure(
                    OVERBURDEN, "403", candidate="country.liechtenstein", data_source="oecd"
                ),
            ],
        )

        read = await runs.read_run(run)

        assert [(f.candidate, f.attribute, f.data_source) for f in read.failures] == [
            ("country.liechtenstein", OVERBURDEN, "oecd"),
            ("country.portugal", OVERCROWDING, "eurostat"),
            ("country.portugal", OVERCROWDING, "world_bank"),
        ]
        assert [(item.candidate, item.attribute) for item in read.unanswered] == [
            ("country.liechtenstein", OVERCROWDING),
            ("country.portugal", OVERBURDEN),
        ]
        assert [reach.data_source for reach in read.by_source] == ["eurostat", "oecd", "world_bank"]


EARLIER = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)
LATER = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def retrieved_at(figure: Value, moment: datetime) -> Value:
    """The same figure, fetched at a moment the test chooses rather than whenever it ran."""
    return figure.model_copy(update={"retrieval_date": moment})


async def portugal_last_answered(pool: AsyncConnectionPool) -> Mapping[tuple[str, str], datetime]:
    return await PostgresRunStore(pool).last_retrieved(
        level="country", candidates=["country.portugal"], attributes=[OVERBURDEN]
    )


@asynccontextmanager
async def switched_off(pool: AsyncConnectionPool, source: str) -> AsyncIterator[None]:
    """A source switched off for the length of a test, then put back as it was: the catalog is
    not test data, so the pool fixture's emptying never reaches it (`conftest.py`)."""
    catalog = PostgresCatalogStore(pool)
    (before,) = [each for each in await catalog.read_data_sources() if each.id == source]
    await catalog.set_data_source(DataSourceId(source), is_enabled=False)
    try:
        yield
    finally:
        await catalog.set_data_source(DataSourceId(source), is_enabled=before.is_enabled)


class TestWhenAPairWasLastAnswered:
    """What the planner reads to judge what is still fresh (`reqs.md` 3.10, BE-25).

    **Only an accepted figure is an answer** (NEW-27). A rejected one is recorded as a failure
    so that a retry reaches it (BE-08); counted here as well, it made its own pair look fresh,
    and with a refetch age set neither a plan nor a scoped run would ask about it again.

    **And only a figure that may score** (NEW-35). A switched-off source's figures stay stored
    but never compete (Q232, the `active_value` view's `source_is_enabled`); counted here, they
    kept an attribute fresh that nothing scores, so switching off its only fresh source left it
    unasked until the age ran out.
    """

    async def test_a_pair_whose_only_figure_was_rejected_has_no_last_retrieval(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """Absent, as a pair never asked about is: nothing usable came back, so the planner has
        a gap to fill rather than a figure to keep."""
        rejected, _ = a_rejected_figure(a_run, "country.portugal")
        await PostgresValueStore(pool).append([retrieved_at(rejected, LATER)])

        assert await portugal_last_answered(pool) == {}

    async def test_a_newer_rejected_figure_leaves_the_accepted_figure_s_date(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The refused figure is the one worth asking for again, so the pair is as fresh as
        its last usable answer and no fresher."""
        rejected, _ = a_rejected_figure(a_run, "country.portugal")
        await PostgresValueStore(pool).append(
            [
                retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN), EARLIER),
                retrieved_at(rejected, LATER),
            ]
        )

        assert await portugal_last_answered(pool) == {("country.portugal", OVERBURDEN): EARLIER}

    async def test_an_accepted_figure_fetched_after_a_rejection_is_the_last_answer(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The control: the rejected figure is set aside, not the pair it belongs to."""
        rejected, _ = a_rejected_figure(a_run, "country.portugal")
        await PostgresValueStore(pool).append(
            [
                retrieved_at(rejected, EARLIER),
                retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN), LATER),
            ]
        )

        assert await portugal_last_answered(pool) == {("country.portugal", OVERBURDEN): LATER}

    async def test_an_accepted_figure_that_lost_the_active_value_comparison_still_counts(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The control on the other side. Losing to a higher-ranked source is not being
        refused: OECD answered, and reading `active_value` instead would ask it again for a
        figure it gave a moment ago."""
        values = PostgresValueStore(pool)
        await values.append(
            [
                retrieved_at(
                    a_figure(a_run, "country.portugal", OVERBURDEN, source="eurostat"), EARLIER
                ),
                retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN, source="oecd"), LATER),
            ]
        )

        (active,) = await values.read_active_values(
            candidates=["country.portugal"], attributes=[OVERBURDEN]
        )
        assert active.data_source == "eurostat", "the premise: OECD's newer figure lost"
        assert await portugal_last_answered(pool) == {("country.portugal", OVERBURDEN): LATER}

    async def test_a_figure_from_a_switched_off_source_is_no_answer(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """Absent, as a pair never asked about is: the figure cannot score, so the planner has a
        gap to fill rather than a figure to keep."""
        await PostgresValueStore(pool).append(
            [retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN, source="oecd"), LATER)]
        )

        async with switched_off(pool, "oecd"):
            assert await portugal_last_answered(pool) == {}

    async def test_a_switched_off_source_leaves_the_switched_on_source_s_date(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The pair is as fresh as its newest figure that may still score, and no fresher."""
        await PostgresValueStore(pool).append(
            [
                retrieved_at(
                    a_figure(a_run, "country.portugal", OVERBURDEN, source="eurostat"), EARLIER
                ),
                retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN, source="oecd"), LATER),
            ]
        )

        async with switched_off(pool, "oecd"):
            assert await portugal_last_answered(pool) == {("country.portugal", OVERBURDEN): EARLIER}

    async def test_switching_the_source_back_on_makes_its_figure_an_answer_again(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The control: the switch decides, not the figure -- nothing was lost by switching off,
        so nothing has to be fetched again once the source is back."""
        await PostgresValueStore(pool).append(
            [retrieved_at(a_figure(a_run, "country.portugal", OVERBURDEN, source="oecd"), LATER)]
        )
        async with switched_off(pool, "oecd"):
            pass

        assert await portugal_last_answered(pool) == {("country.portugal", OVERBURDEN): LATER}


class TestSweepingRunsAProcessAbandoned:
    """`arch.md` 9.2 step 4. Nothing else starts a run (`reqs.md` 10), so a run still `running`
    when the application boots is one whose process died.

    **Marked `failed`, not `completed`:** it did not finish. The values it wrote before it died
    keep its id, which is what makes the difference between what was asked for and what arrived
    readable afterwards -- and what makes a retry meaningful.
    """

    async def test_a_run_left_running_is_failed_and_named(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        store = PostgresRunStore(pool)

        swept = await store.sweep_abandoned_runs(finished_at=datetime.now(UTC))

        assert a_run in swept
        assert (await store.read_run(a_run)).status is RunStatus.FAILED

    async def test_the_figures_it_wrote_before_it_died_are_untouched(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The whole reason the sweep is safe: commits are per item (`arch.md` 7.1), so a run
        that died halfway left real values behind and they are not the sweep's business."""
        await PostgresValueStore(pool).append([a_figure(a_run, "country.portugal", OVERBURDEN)])

        await PostgresRunStore(pool).sweep_abandoned_runs(finished_at=datetime.now(UTC))

        run = await PostgresRunStore(pool).read_run(a_run)
        assert run.items_completed == 1
        assert run.status is RunStatus.FAILED

    async def test_a_finished_run_is_left_alone(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The control. A completed run swept to `failed` would rewrite history at every boot."""
        store = PostgresRunStore(pool)
        await store.finish_run(a_run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC))

        swept = await store.sweep_abandoned_runs(finished_at=datetime.now(UTC))

        assert a_run not in swept
        assert (await store.read_run(a_run)).status is RunStatus.COMPLETED

    async def test_an_ordinary_boot_sweeps_nothing(self, pool: AsyncConnectionPool) -> None:
        """No run in flight, so nothing to report -- and the boot log says so rather than
        staying silent, because "no abandoned run" is information."""
        assert (
            await PostgresRunStore(pool).sweep_abandoned_runs(finished_at=datetime.now(UTC)) == ()
        )

    async def test_the_sweep_records_when_it_gave_up_on_them(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """A run with no `finished_at` reads as still running, whatever its status says."""
        moment = datetime.now(UTC)

        await PostgresRunStore(pool).sweep_abandoned_runs(finished_at=moment)

        assert (await PostgresRunStore(pool).read_run(a_run)).finished_at is not None


class ProcessKilled(BaseException):
    """kill -9, as near as a test gets. `continue_run` catches `Exception` and writes its failures
    on the way out, which would hide the order under test; it cannot catch this."""


class KilledWriting:
    """The real value store, killed as a figure `dies_at` picks out reaches it."""

    def __init__(self, store: PostgresValueStore, dies_at: Callable[[Value], bool]) -> None:
        self._store = store
        self._dies_at = dies_at

    async def append(self, values: Sequence[Value]) -> tuple[Value, ...]:
        if any(self._dies_at(value) for value in values):
            raise ProcessKilled
        return await self._store.append(values)

    async def record_reuse(self, run, data_source, pairs) -> None:  # type: ignore[no-untyped-def]
        await self._store.record_reuse(run, data_source, pairs)

    async def read_observations(self, values: Sequence[Value]) -> tuple[Value, ...]:
        return await self._store.read_observations(values)

    async def read_active_values(self, **asked) -> tuple[Value, ...]:  # type: ignore[no-untyped-def]
        return await self._store.read_active_values(**asked)


class AnswersWith(SourceAdapter):
    """Eurostat, answering the overburden rate with exactly the figures it was given."""

    def __init__(self, *figures: Value) -> None:
        self._figures = figures

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("eurostat")

    @property
    def attributes(self) -> tuple:
        return (OVERBURDEN,)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        return Acquired(values=self._figures)


def a_ratio_attribute(identifier: str) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


def switzerland_standing_in_for_liechtenstein(attribute: str) -> StandIn:
    return StandIn(
        candidate="country.liechtenstein",
        candidate_name="Liechtenstein",
        attribute=attribute,
        substitute="country.switzerland",
        substitute_name="Switzerland",
        reason="no source covers Liechtenstein for this",
    )


A_COUNTRY = {"id": "country", "depth_order": 1}
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=A_COUNTRY, country_code="PT")
LIECHTENSTEIN = Candidate(
    id="country.liechtenstein", name="Liechtenstein", level=A_COUNTRY, country_code="LI"
)


class TestWhatAKilledRunLeavesForARetry:
    """P93. A kill never leaves a written figure without the failure a retry reads.

    The sweep is what the next boot does to the run a kill left `running`, so what it reads
    afterwards is what the household sees.
    """

    async def test_a_rejection_killed_before_its_figure_reads_failed(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """Killed as the rejected figure is written, its failure is already committed: the pair
        counts as failed, which a retry reaches, rather than unanswered."""
        runs = PostgresRunStore(pool)
        rejected, _ = a_rejected_figure(a_run, "country.portugal")

        with pytest.raises(ProcessKilled):
            await acquire(
                adapter=AnswersWith(rejected),
                attributes=[a_ratio_attribute(OVERBURDEN)],
                candidates=[PORTUGAL],
                values=KilledWriting(
                    PostgresValueStore(pool), dies_at=lambda value: value.is_rejected
                ),
                run=a_run,
                record_failures=lambda batch: runs.record_failures(a_run, batch),
            )
        await runs.sweep_abandoned_runs(finished_at=datetime.now(UTC))

        swept = await runs.read_run(a_run)
        assert (swept.items_failed, swept.items_unanswered) == (1, 0)
        assert await reach_of(pool, a_run) == {"eurostat": (0, 1)}

    async def test_a_borrow_killed_while_its_copies_are_written_keeps_what_it_could_not_lend(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The stand-in step's failures were held until the run ended, so a kill while its copies
        were written lost them and a pair with nothing to borrow read as unanswered. Switzerland
        lends its overburden rate, has no overcrowding rate to lend, and the kill lands on the
        copy -- so the overburden rate it never lent is not reached, not unanswered (C04-N6)."""
        runs, values = PostgresRunStore(pool), PostgresValueStore(pool)
        await values.append([a_figure(None, "country.switzerland", OVERBURDEN)])
        run = await runs.start_run(
            RunScope(
                level="country",
                candidates=(str(LIECHTENSTEIN.id),),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
            triggered_by="test",
            plan=RunPlan(
                items_planned={(STAND_IN, OVERBURDEN): 1, (STAND_IN, OVERCROWDING): 1},
                estimate_ceiling_eur=Decimal(0),
                spend_cap_eur=None,
                accepted_uncapped=False,
            ),
        )

        with pytest.raises(ProcessKilled):
            await continue_run(
                OpenedRun(
                    id=run,
                    adapters=(),
                    answerable=(),
                    in_scope=(a_ratio_attribute(OVERBURDEN), a_ratio_attribute(OVERCROWDING)),
                    candidates=(LIECHTENSTEIN,),
                    values=KilledWriting(
                        values, dies_at=lambda value: value.data_source == STAND_IN
                    ),
                    runs=runs,
                    stand_ins=(
                        switzerland_standing_in_for_liechtenstein(OVERBURDEN),
                        switzerland_standing_in_for_liechtenstein(OVERCROWDING),
                    ),
                    meter=CostMeter(cap_eur=None),
                )
            )
        await runs.sweep_abandoned_runs(finished_at=datetime.now(UTC))

        swept = await runs.read_run(run)
        assert (swept.items_failed, swept.items_unanswered, swept.items_not_reached) == (1, 0, 1)
        assert [(f.data_source, f.attribute) for f in swept.failures] == [(STAND_IN, OVERCROWDING)]
        assert [(item.candidate, item.attribute) for item in swept.not_reached] == [
            (str(LIECHTENSTEIN.id), OVERBURDEN)
        ]


class TestAskingARunToStop:
    """`reqs.md` 6.4. A person can stop a run, and the run says so afterwards.

    **The request is a row, not a flag in memory.** The loop runs as a background task, so an
    in-process flag would be invisible to the poll that reports the run's state and lost
    entirely the moment anything ran in a second process.
    """

    async def test_a_running_run_takes_the_request(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        store = PostgresRunStore(pool)

        assert await store.request_stop(a_run) is True
        assert await store.stop_was_requested(a_run) is True
        assert (await store.read_run(a_run)).stop_requested_at is not None

    async def test_a_run_nobody_stopped_says_so(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        store = PostgresRunStore(pool)

        assert await store.stop_was_requested(a_run) is False
        assert (await store.read_run(a_run)).stop_requested_at is None

    async def test_a_finished_run_is_left_unmarked(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """**Not an error, and not a mark.** The outcome the caller wanted is already true, and
        stamping a time would make a run that ended on its own read as one somebody intervened
        in -- which is exactly what the fifth status exists to keep apart."""
        store = PostgresRunStore(pool)
        await store.finish_run(a_run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC))

        assert await store.request_stop(a_run) is False
        assert (await store.read_run(a_run)).stop_requested_at is None

    async def test_the_first_ask_is_the_one_recorded(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """A second click records nothing new: the fact worth keeping is when the stop was
        asked for, not when somebody last asked again."""
        store = PostgresRunStore(pool)
        await store.request_stop(a_run)
        first = (await store.read_run(a_run)).stop_requested_at

        await store.request_stop(a_run)

        assert (await store.read_run(a_run)).stop_requested_at == first

    async def test_a_run_that_does_not_exist_takes_nothing(self, pool: AsyncConnectionPool) -> None:
        assert await PostgresRunStore(pool).request_stop(999_999) is False

    async def test_a_stopped_run_records_the_fifth_status(
        self, pool: AsyncConnectionPool, a_run: int
    ) -> None:
        """The schema allows it and the three ways of not finishing stay three facts."""
        store = PostgresRunStore(pool)
        await store.request_stop(a_run)

        await store.finish_run(
            a_run, status=RunStatus.HALTED_BY_USER, finished_at=datetime.now(UTC)
        )

        assert (await store.read_run(a_run)).status is RunStatus.HALTED_BY_USER


def a_spend(gate: str, candidate: str, cost: str, *, calls: int = 1) -> ResearchSpend:
    """What one gate-research call billed, as the research pass hands it over."""
    return ResearchSpend(
        match_rule=MatchRuleId(gate),
        candidate=CandidateId(candidate),
        data_source=DataSourceId("llm"),
        llm_call_count=calls,
        cost_eur=Decimal(cost),
    )


async def _the_ledger(pool: AsyncConnectionPool) -> list[tuple]:
    """The ledger as the table holds it. Read directly, because the API serves only its monthly
    sum, never its rows (BE-34, C04-N1)."""
    async with pool.connection() as connection:
        cursor = await connection.execute(
            "SELECT match_rule, candidate, data_source, llm_call_count, cost_eur, researched_at "
            "FROM match_rule_research_spend ORDER BY id"
        )
        return [tuple(row) for row in await cursor.fetchall()]


class TestTheResearchSpendLedger:
    """BE-34, revisiting Q224. **Gate research spends money and writes no run**, so what each
    call billed is kept in a ledger of its own, one row per billed call, written as it happens."""

    async def test_research_spend_is_written_per_call(self, pool: AsyncConnectionPool) -> None:
        store = PostgresRunStore(pool)

        await store.record_research_spend(
            a_spend("ch_eu_efta_quota", "country.switzerland", "0.04")
        )
        await store.record_research_spend(
            a_spend("uk_skilled_worker", "country.united_kingdom", "0.07", calls=2)
        )

        assert [row[:5] for row in await _the_ledger(pool)] == [
            ("ch_eu_efta_quota", "country.switzerland", "llm", 1, Decimal("0.04")),
            ("uk_skilled_worker", "country.united_kingdom", "llm", 2, Decimal("0.07")),
        ]

    async def test_each_row_is_stamped_with_the_moment_it_was_kept(
        self, pool: AsyncConnectionPool
    ) -> None:
        """ "What did this month cost?" is a sum over a span, so every row needs its moment --
        an instant, with its zone, set by the database rather than trusted from the caller."""
        await PostgresRunStore(pool).record_research_spend(
            a_spend("li_eea_quota", "country.liechtenstein", "0.05")
        )

        ((*_, researched_at),) = await _the_ledger(pool)
        assert researched_at.tzinfo is not None
        assert abs(researched_at - datetime.now(UTC)) < timedelta(minutes=5)

    async def test_a_negative_cost_is_refused(self, pool: AsyncConnectionPool) -> None:
        with pytest.raises(errors.CheckViolation):
            await PostgresRunStore(pool).record_research_spend(
                a_spend("uk_skilled_worker", "country.united_kingdom", "-0.01")
            )

    async def test_a_negative_call_count_is_refused(self, pool: AsyncConnectionPool) -> None:
        with pytest.raises(errors.CheckViolation):
            await PostgresRunStore(pool).record_research_spend(
                a_spend("uk_skilled_worker", "country.united_kingdom", "0.01", calls=-1)
            )

    async def test_a_gate_the_catalog_does_not_have_is_refused(
        self, pool: AsyncConnectionPool
    ) -> None:
        """Spend on a gate that does not exist is a fault upstream, and a row naming it would be
        money nobody could trace to a question."""
        with pytest.raises(errors.ForeignKeyViolation):
            await PostgresRunStore(pool).record_research_spend(
                a_spend("no_such_gate", "country.united_kingdom", "0.01")
            )

        assert await _the_ledger(pool) == []
