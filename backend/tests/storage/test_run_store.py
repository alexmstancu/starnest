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
from starnest.data_acquisition import AcquisitionFailure, RunScope
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


def a_figure(run: int, candidate: str, attribute: str) -> Value:
    """One stored figure, with the provenance every value carries and nothing incidental."""
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.RATIO,
        data_source="eurostat",
        reference_period=ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31)),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=Ratio(value=Decimal("6.3"), basis="households"),
        data_acquisition_run=run,
    )
