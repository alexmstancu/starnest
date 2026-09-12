"""The API as a client sees it, over HTTP, against a real database.

`arch.md` 6.1: the acceptance suite is **another client of the same contract**, which is what
makes the API a real boundary rather than an intention. It calls the app the composition root
builds, wired to the same PostgreSQL stores the server uses -- so a response here is a response,
not a mock's opinion of one.

The database is the workstream's own, dropped and migrated per session by `tests/conftest.py`,
and it holds the seeded catalog. Values are written by the tests that need them and removed
afterwards, exactly as the storage suite does.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.api import build_app
from starnest.data_acquisition import SourceAdapter
from starnest.storage import (
    PostgresCandidateStore,
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresEvaluationStore,
    PostgresHouseholdStore,
    PostgresMatchRuleResultStore,
    PostgresRunStore,
    PostgresValueStore,
)

WRITABLE_TABLES = (
    "value",
    "household",
    "household_citizenship",
    "settings",
    "data_acquisition_run",
    "match_rule_result",
    "external_score",
    "evaluation",
)
"""What an acceptance test may write and what is emptied afterwards.

**The criteria tables are not here**, and a test that changes a criteria set must therefore
make its own. The seeded catalog is read by every other suite, so a test that edited a shipped
weight would leave the next one reading a number nobody put there -- which happened once, and
is why `a_scratch_criteria_set` exists.
"""


@pytest.fixture
async def api(database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """A client speaking to the real application, over ASGI rather than a socket.

    No port, no server process: `ASGITransport` runs the same app object the composition root
    builds. What is under test is the application, and binding a socket would only add a way for
    the test to fail for reasons that are not about it.
    """
    async with an_api(database_url, (a_stub_source(),)) as client:
        yield client


@pytest.fixture
async def api_over_two_sources(database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """The same application with a second source beside the first.

    Every other acceptance test runs against one source, which is how `POST
    /data-acquisition-runs` came to fetch from the first adapter only while its plan counted all
    six: with one adapter, "the first" and "all of them" are the same thing, and no test could
    tell them apart.
    """
    second = a_stub_source(data_source="world_bank", answers=(A_SECOND_SOURCE_ANSWERS,))
    async with an_api(database_url, (a_stub_source(), second)) as client:
        yield client


A_SECOND_SOURCE_ANSWERS = "country.broadband_coverage"


@asynccontextmanager
async def an_api(
    database_url: str,
    adapters: tuple[SourceAdapter, ...],
    researcher: object | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """The application over the sources given, emptied of what the test wrote when it closes.

    `researcher` is the gate-research seam (`reqs.md` 6.10 use 3). `None` is the shipped state --
    no model configured -- and the endpoint answers 501 rather than an empty success.
    """
    async with AsyncConnectionPool(database_url, min_size=1, max_size=4, open=False) as pool:
        await pool.open(wait=True)
        app = build_app(
            households=PostgresHouseholdStore(pool),
            criteria_store=PostgresCriteriaStore(pool),
            candidates=PostgresCandidateStore(pool),
            values=PostgresValueStore(pool),
            catalog_store=PostgresCatalogStore(pool),
            run_store=PostgresRunStore(pool),
            match_rule_results=PostgresMatchRuleResultStore(pool),
            evaluation_store=PostgresEvaluationStore(pool),
            adapters=adapters,
            researcher=researcher,  # type: ignore[arg-type]
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
            try:
                yield client
            finally:
                async with pool.connection() as connection:
                    await connection.execute(
                        f"TRUNCATE {', '.join(WRITABLE_TABLES)} RESTART IDENTITY CASCADE"
                    )


@pytest.fixture
async def a_scratch_criteria_set(database_url: str) -> AsyncIterator[str]:
    """A copy of the shipped `minimal` set, for tests that change a weight.

    Duplicated rather than built by hand so it has the shape the application actually ships --
    two pillars, three criteria, percentile throughout -- while belonging to the test that uses
    it. `duplicate_criteria_set` is the same query the product's own duplicate feature uses.
    """
    scratch = "acceptance_scratch"
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        criteria = PostgresCriteriaStore(pool)
        await criteria.create_criteria_set(
            (await criteria.read_criteria_set("minimal")).duplicated_as(scratch, "Scratch")
        )
        try:
            yield scratch
        finally:
            # An evaluation keeps the identifier of the set it was computed from, so a saved
            # one holds this set in place. The test that keeps one owns it, and this owns the
            # set: dropping the evaluations first is what lets both be true.
            async with pool.connection() as connection:
                await connection.execute(
                    "DELETE FROM candidate_attribute_score WHERE candidate_result IN"
                    " (SELECT r.id FROM candidate_result AS r JOIN evaluation AS e"
                    "  ON e.id = r.evaluation WHERE e.criteria_set = %s)",
                    (scratch,),
                )
                await connection.execute(
                    "DELETE FROM candidate_result WHERE evaluation IN"
                    " (SELECT id FROM evaluation WHERE criteria_set = %s)",
                    (scratch,),
                )
                for table in ("evaluation_scale_anchor", "evaluation_criterion"):
                    await connection.execute(
                        f"DELETE FROM {table} WHERE evaluation IN"
                        " (SELECT id FROM evaluation WHERE criteria_set = %s)",
                        (scratch,),
                    )
                await connection.execute(
                    "DELETE FROM evaluation WHERE criteria_set = %s", (scratch,)
                )
            await criteria.delete_criteria_set(scratch)


@pytest.fixture
async def stored_figures(database_url: str) -> AsyncIterator[None]:
    """Real figures for two countries, so a response is checked with data in it as well as
    without.

    Two shapes, not one: an endpoint that validates when every field is null and fails when they
    carry numbers is the likelier of the two to ship, because nulls are what a first test reaches
    and numbers are what a user sees.
    """
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.data import (
        ConfidenceLevel,
        Quantity,
        Ratio,
        ReferencePeriod,
        Value,
        ValueType,
    )

    a_year = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))

    def a_figure(candidate: str, attribute: str, figure: str) -> Value:
        satisfaction = attribute == "country.life_satisfaction"
        return Value(
            candidate=candidate,
            attribute=attribute,
            value_type=ValueType.QUANTITY if satisfaction else ValueType.RATIO,
            data_source="eurostat",
            reference_period=a_year,
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=(
                Quantity(magnitude=Decimal(figure), unit="ladder_points")
                if satisfaction
                else Ratio(value=Decimal(figure), basis="households")
            ),
        )

    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO settings (id, score_scale_max) VALUES (1, 100)"
                " ON CONFLICT (id) DO UPDATE SET score_scale_max = 100"
            )
        await PostgresValueStore(pool).append(
            [
                a_figure("country.portugal", "country.housing_cost_overburden_rate", "5"),
                a_figure("country.portugal", "country.overcrowding_rate", "9"),
                a_figure("country.portugal", "country.life_satisfaction", "7.1"),
                a_figure("country.greece", "country.housing_cost_overburden_rate", "28"),
                a_figure("country.greece", "country.overcrowding_rate", "27"),
                a_figure("country.greece", "country.life_satisfaction", "6.4"),
            ]
        )
    yield


@pytest.fixture
async def an_external_score(database_url: str) -> AsyncIterator[None]:
    """One published composite, stored for the drill-down to show beside the score.

    Never an input to anything: `reqs.md` 3.5a keeps outside indices out of the arithmetic, and
    the only place one may appear is beside a number of our own.
    """
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.data import ExternalScore, ReferencePeriod

    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        await PostgresValueStore(pool).append_external_score(
            ExternalScore(
                candidate="country.portugal",
                data_source="numbeo",
                published_scale="0-100, higher is safer",
                published_value=Decimal("72.4"),
                reference_period=ReferencePeriod(start=date(2026, 1, 1), end=date(2026, 6, 30)),
                retrieval_date=datetime.now(UTC),
                caveats="Crowdsourced, and its weighting is the publisher's own.",
            )
        )
    yield


A_HOUSEHOLD = {
    "net_income": 5200,
    "number_adults": 2,
    "number_children": 1,
    "home_country_candidate": "country.romania",
    "citizenships": ["country.romania"],
    "target_monthly_spend": 2500,
    "max_rent": 1400,
}
"""One household, in the shape `HouseholdInput` describes.

Romania as the home country because `reqs.md` Q30 makes it both baseline and candidate -- "stay
put" has to be measurable, so the home country is scored like any other.
"""


@pytest.fixture
async def a_configured_household(api: httpx.AsyncClient) -> str:
    """A stored household, for the endpoints that have nothing to say without one.

    Written through the API rather than the store: a fixture that reached past the endpoint
    would let a broken PUT pass every test that depends on a household existing.
    """
    response = await api.put("/v1/household", json=A_HOUSEHOLD)
    assert response.status_code == 200
    return "configured"


def a_stub_source(
    data_source: str = "eurostat",
    answers: tuple[str, ...] = (
        "country.housing_cost_overburden_rate",
        "country.overcrowding_rate",
    ),
    silent_about: tuple[str, ...] = ("country.portugal",),
    silent_on: tuple[str, ...] | None = None,
    unreachable: bool = False,
    no_row_for: tuple[str, ...] = (),
    charges: bool = False,
) -> SourceAdapter:
    """A source that answers instantly with figures the test controls.

    **`silent_about` fails; `no_row_for` says nothing.** The two are different facts and the run
    counts them differently (`reqs.md` Q217): a source that declines has failed and can be asked
    again, while a source with no row for a country answered perfectly well and simply does not
    cover it -- which is Eurostat and Liechtenstein, and the case that used to be counted as
    neither.

    **Not Eurostat.** An acceptance test that fetched from the real API would fail when Eurostat
    is slow, which says nothing about this application, and would put a network round trip in
    every run of the suite. What is under test here is the *run*: that it is recorded before
    anything is fetched, that values carry it, that failures are kept and that progress can be
    polled. Eurostat's own behaviour is tested where Eurostat lives, against captured responses.
    """
    from collections.abc import Sequence
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.candidates import Candidate
    from starnest.data import (
        Attribute,
        ConfidenceLevel,
        DataSourceId,
        Quantity,
        Ratio,
        ReferencePeriod,
        Value,
    )
    from starnest.data_acquisition import Acquired, AcquisitionFailure

    def a_figure_shaped_for(attribute: Attribute) -> Quantity | Ratio:
        if attribute.quantity_parameters is not None:
            return Quantity(magnitude=Decimal("7.5"), unit=attribute.quantity_parameters.unit)
        return Ratio(value=Decimal("7.5"), basis="households")

    class StubSource(SourceAdapter):
        @property
        def data_source(self) -> DataSourceId:
            return DataSourceId(data_source)

        @property
        def costs_money(self) -> bool:
            """Free unless a test says otherwise, as every structured source is. A run including
            a charging source refuses without a spend cap (`reqs.md` 6.3)."""
            return charges

        @property
        def attributes(self) -> tuple:
            return answers

        async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
            if unreachable:
                # A whole source failing, for no candidate in particular -- OECD behind a
                # browser challenge -- which is how an adapter reports an HTTP refusal.
                return Acquired(
                    failures=(AcquisitionFailure(attribute=attribute.id, reason="unreachable"),)
                )
            values, failures = [], []
            for candidate in candidates:
                if str(candidate.id) in no_row_for:
                    # Answered, with nothing for this candidate. No figure and no failure --
                    # which is exactly what a real indicator does for a country it omits.
                    continue
                if str(candidate.id) in silent_about and (
                    silent_on is None or str(attribute.id) in silent_on
                ):
                    # One reproducible failure, so a run always has something to report and the
                    # failure path is exercised by every test rather than by a special one.
                    failures.append(
                        AcquisitionFailure(
                            attribute=attribute.id,
                            candidate=str(candidate.id),
                            reason="the stub source declines to answer for this candidate",
                        )
                    )
                    continue
                values.append(
                    Value(
                        candidate=candidate.id,
                        attribute=attribute.id,
                        value_type=attribute.value_type,
                        data_source=data_source,
                        reference_period=ReferencePeriod(
                            start=date(2025, 1, 1), end=date(2025, 12, 31)
                        ),
                        retrieval_date=datetime.now(UTC),
                        confidence_level=ConfidenceLevel.HIGH,
                        payload=a_figure_shaped_for(attribute),
                    )
                )
            return Acquired(values=tuple(values), failures=tuple(failures))

    return StubSource()
