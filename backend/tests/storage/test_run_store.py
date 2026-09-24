"""What the run store refuses to write (`0461`), and how it accounts for a run (Q217).

A failure is the unit a retry addresses: one source, asked about one candidate's attribute. One
arriving without a candidate or a source cannot be retried, and storing it against a guessed
candidate would be inventing a fact about a place.

The counts are read here rather than in a unit test because they are **derived in SQL** from the
scope, the value rows and the failure rows. A fake store could only return whatever a fake was
told to; what is under test is the derivation itself.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import ConfidenceLevel, Ratio, ReferencePeriod, Value, ValueType
from starnest.data_acquisition import AcquisitionFailure, RunScope, RunStatus
from starnest.storage import PostgresRunStore, PostgresValueStore

pytestmark = pytest.mark.storage

OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"


@pytest.fixture
async def a_run(pool: AsyncConnectionPool) -> int:
    return await PostgresRunStore(pool).start_run(
        RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,)),
        triggered_by="test",
    )


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
        return await PostgresRunStore(pool).start_run(
            RunScope(
                level="country",
                candidates=("country.liechtenstein", "country.portugal"),
                attributes=(OVERBURDEN, OVERCROWDING),
            ),
            triggered_by="test",
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
        every gap would be hidden by whatever an earlier run happened to store."""
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


def a_figure(run: int, candidate: str, attribute: str, source: str = "eurostat") -> Value:
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
