"""What the run store refuses to write (`0461`).

A failure is the unit a retry addresses: one source, asked about one candidate's attribute. One
arriving without a candidate or a source cannot be retried, and storing it against a guessed
candidate would be inventing a fact about a place.
"""

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data_acquisition import AcquisitionFailure, RunScope
from starnest.storage import PostgresRunStore

pytestmark = pytest.mark.storage

OVERBURDEN = "country.housing_cost_overburden_rate"


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
