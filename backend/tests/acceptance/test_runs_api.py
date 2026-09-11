"""Data acquisition through the API: plan it, start it, watch it.

Gate A steps 4 and 5. Driven against a stub source rather than Eurostat -- what is under test is
the *run*: that it is recorded before anything is fetched, that values carry it, that failures
are kept rather than raised, and that progress can be polled. Eurostat's own behaviour is tested
where Eurostat lives, against captured responses.
"""

from collections.abc import AsyncIterator

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from .conftest import A_SECOND_SOURCE_ANSWERS, a_stub_source, an_api

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
THE_STUB_DECLINES_FOR = "country.portugal"


class TestPlanningARun:
    async def test_a_plan_costs_nothing_and_fetches_nothing(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`reqs.md` 6.3 requires the count and the cost *before* anything is fetched. A plan
        that ran the thing to find out would defeat the purpose."""
        planned = await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})

        assert planned.status_code == 200
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                stored = await (await connection.execute("SELECT count(*) FROM value")).fetchone()
        assert stored == (0,)

    async def test_the_plan_counts_the_work_the_sources_can_actually_do(
        self, api: httpx.AsyncClient
    ) -> None:
        """The cross product of candidates and *answerable* attributes. Counting the 41 the
        catalog holds would promise work nothing can perform."""
        body = (await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})).json()

        assert body["items_total"] == 32 * 2
        assert body["by_source"] == [{"data_source": "eurostat", "items": 64}]

    async def test_a_narrowed_scope_plans_less_work(self, api: httpx.AsyncClient) -> None:
        body = (
            await api.post(
                "/v1/data-acquisition-runs/plan",
                json={"level": COUNTRY, "candidates": ["country.greece"]},
            )
        ).json()

        assert body["items_total"] == 2

    async def test_nothing_is_claimed_about_llm_cost_while_there_is_no_llm(
        self, api: httpx.AsyncClient
    ) -> None:
        """Zero because it is zero, not as a placeholder. The LLM path is `reqs.md` 6.10 and the
        city level; a guess here would be the invented figure the estimate exists to prevent."""
        body = (await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})).json()

        assert body["llm_call_count"] == 0
        assert body["estimated_cost_eur"] == 0


class TestStartingARun:
    async def test_it_is_accepted_and_given_an_identifier(self, api: httpx.AsyncClient) -> None:
        response = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert response.status_code == 202
        assert response.json()["id"] > 0
        assert response.json()["triggered_by"]

    async def test_the_values_it_fetched_carry_it(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`reqs.md` 3.8. This is what lets a figure on screen say which pass produced it, and
        what makes "re-run just this" answerable later."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                unstamped = await (
                    await connection.execute(
                        "SELECT count(*) FROM value WHERE data_acquisition_run IS DISTINCT FROM %s",
                        (run["id"],),
                    )
                ).fetchone()
        assert unstamped == (0,)

    async def test_a_run_completes_even_though_items_failed(self, api: httpx.AsyncClient) -> None:
        """A run completes for everything that works and reports the rest (`reqs.md` 6.4).
        Sparse coverage makes routine failure the norm, so treating one as a failed run would
        mean never completing one."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
        assert detail["run_status"] == "completed"
        assert detail["progress"]["items_failed"] > 0

    async def test_a_narrowed_scope_fetches_only_what_it_named(
        self, api: httpx.AsyncClient
    ) -> None:
        run = (
            await api.post(
                "/v1/data-acquisition-runs",
                json={"level": COUNTRY, "candidates": ["country.greece"]},
            )
        ).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
        assert detail["scope"]["candidates"] == ["country.greece"]


class TestWatchingARun:
    async def test_the_scope_recorded_is_what_was_asked_for(self, api: httpx.AsyncClient) -> None:
        """Planned, not achieved. A candidate that produced nothing must stay distinguishable
        from one nobody asked about -- which is the difference selective retry turns on."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert len(detail["scope"]["candidates"]) == 32
        assert THE_STUB_DECLINES_FOR in detail["scope"]["candidates"]

    async def test_progress_counts_what_answered_and_what_did_not(
        self, api: httpx.AsyncClient
    ) -> None:
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        progress = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()["progress"]

        # Completed counts distinct (candidate, attribute) pairs that produced a value, so it
        # is 31 candidates against both attributes -- not 31 candidates.
        assert progress["items_total"] == 32 * 2
        assert progress["items_completed"] == 31 * 2
        assert progress["items_failed"] == 2

    async def test_each_failure_names_the_pair_a_retry_would_address(
        self, api: httpx.AsyncClient
    ) -> None:
        """Failures are rows, not a blob: the (candidate, attribute) pair is the unit."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        failures = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()["failures"]

        assert {failure["candidate"] for failure in failures} == {THE_STUB_DECLINES_FOR}
        assert all(failure["error_message"] for failure in failures)

    async def test_a_run_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.get("/v1/data-acquisition-runs/999999")

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"


class TestListingRuns:
    async def test_runs_come_back_newest_first_with_a_total(self, api: httpx.AsyncClient) -> None:
        """One of the three lists that grow without bound, so it is paginated (`arch.md` 7.6)."""
        first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
        second = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        body = (await api.get("/v1/data-acquisition-runs")).json()

        assert body["total"] == 2
        assert [run["id"] for run in body["items"]] == [second["id"], first["id"]]

    async def test_a_page_is_a_page(self, api: httpx.AsyncClient) -> None:
        for _ in range(3):
            await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        page = (await api.get("/v1/data-acquisition-runs", params={"limit": 2})).json()

        assert len(page["items"]) == 2
        assert page["total"] == 3


class TestARunOverSeveralSources:
    """`POST /data-acquisition-runs` once fetched from the first adapter only, while its plan
    counted all six. Every test above runs against one source, where the two cannot differ."""

    async def test_every_source_is_asked_not_only_the_first(
        self, api_over_two_sources: httpx.AsyncClient, database_url: str
    ) -> None:
        await api_over_two_sources.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                rows = await (
                    await connection.execute("SELECT DISTINCT data_source FROM value")
                ).fetchall()
        assert {source for (source,) in rows} == {"eurostat", "world_bank"}

    async def test_the_run_does_the_work_its_plan_promised(
        self, api_over_two_sources: httpx.AsyncClient
    ) -> None:
        """The plan is what the household confirms before a run (`reqs.md` 6.3). A run that
        then did a third of it would make the confirmation a formality."""
        planned = (
            await api_over_two_sources.post(
                "/v1/data-acquisition-runs/plan", json={"level": COUNTRY}
            )
        ).json()
        run = (
            await api_over_two_sources.post("/v1/data-acquisition-runs", json={"level": COUNTRY})
        ).json()

        detail = (await api_over_two_sources.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
        assert detail["progress"]["items_total"] == planned["items_total"] == 32 * 3

    async def test_the_scope_recorded_names_what_every_source_answers(
        self, api_over_two_sources: httpx.AsyncClient
    ) -> None:
        run = (
            await api_over_two_sources.post("/v1/data-acquisition-runs", json={"level": COUNTRY})
        ).json()

        detail = (await api_over_two_sources.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
        assert sorted(detail["scope"]["attributes"]) == [
            A_SECOND_SOURCE_ANSWERS,
            OVERBURDEN,
            "country.overcrowding_rate",
        ]

    async def test_two_sources_answering_one_attribute_are_one_item_per_country(
        self, database_url: str
    ) -> None:
        """An item is one candidate and one attribute -- the unit progress counts and a retry
        addresses. OECD and the estimate both answer the tax rate, and a plan that counted it
        twice would promise work the run's progress can never reach."""
        overlapping = (
            a_stub_source(),
            a_stub_source(data_source="world_bank", answers=("country.overcrowding_rate",)),
        )
        async with an_api(database_url, overlapping) as api:
            planned = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert planned["items_total"] == detail["progress"]["items_total"] == 32 * 2
        assert planned["by_source"] == [
            {"data_source": "eurostat", "items": 64},
            {"data_source": "world_bank", "items": 32},
        ]


PRICES = "country.cost_of_living_index"
LIECHTENSTEIN = "country.liechtenstein"


class TestAStandInThroughARun:
    """`reqs.md` Q208: where no source covers Liechtenstein, Switzerland's figure stands in --
    under its own source, at low confidence, and saying so."""

    @pytest.fixture
    async def a_source_silent_about_liechtenstein(
        self, database_url: str
    ) -> AsyncIterator[httpx.AsyncClient]:
        prices = a_stub_source(answers=(PRICES,), silent_about=(LIECHTENSTEIN,))
        async with an_api(database_url, (prices,)) as api:
            yield api

    async def _what_is_stored_for_liechtenstein(
        self, database_url: str
    ) -> list[tuple[str, str, str, bool]]:
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                rows = await (
                    await connection.execute(
                        "SELECT v.data_source, v.confidence_level, v.quote,"
                        "       v.id IN (SELECT a.id FROM active_value AS a)"
                        " FROM value AS v WHERE v.candidate = %s AND v.attribute = %s",
                        (LIECHTENSTEIN, PRICES),
                    )
                ).fetchall()
        return [tuple(row) for row in rows]

    async def test_liechtenstein_gets_switzerlands_figure_under_its_own_source(
        self, a_source_silent_about_liechtenstein: httpx.AsyncClient, database_url: str
    ) -> None:
        await a_source_silent_about_liechtenstein.post(
            "/v1/data-acquisition-runs", json={"level": COUNTRY}
        )

        ((source, confidence, quote, active),) = await self._what_is_stored_for_liechtenstein(
            database_url
        )
        assert (source, confidence, active) == ("stand_in", "low", True)
        assert quote.startswith("Switzerland's figure, standing in for Liechtenstein.")

    async def test_the_run_counts_the_stand_in_as_the_items_answer(
        self, a_source_silent_about_liechtenstein: httpx.AsyncClient
    ) -> None:
        run = (
            await a_source_silent_about_liechtenstein.post(
                "/v1/data-acquisition-runs", json={"level": COUNTRY}
            )
        ).json()

        detail = (
            await a_source_silent_about_liechtenstein.get(f"/v1/data-acquisition-runs/{run['id']}")
        ).json()
        assert detail["progress"]["items_completed"] == 32

    async def test_a_real_figure_outranks_the_stand_in_and_both_stay_stored(
        self, database_url: str
    ) -> None:
        """The day a source publishes Liechtenstein's own figure it wins, and nobody has to
        delete the stand-in for that to happen."""
        async with an_api(database_url, (a_stub_source(answers=(PRICES,)),)) as api:
            await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

            stored = await self._what_is_stored_for_liechtenstein(database_url)

        assert sorted((source, active) for source, _, _, active in stored) == [
            ("eurostat", True),
            ("stand_in", False),
        ]


async def _count(database_url: str, query: str, *parameters: object) -> int:
    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        async with pool.connection() as connection:
            row = await (await connection.execute(query, parameters)).fetchone()
    assert row is not None
    return int(row[0])


class TestWhatAFailureRecords:
    async def test_a_failure_names_the_source_that_failed(self, api: httpx.AsyncClient) -> None:
        """Two sources answer the total tax rate; a retry has to know which one to ask again."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        failures = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()["failures"]

        assert {failure["data_source"] for failure in failures} == {"eurostat"}

    async def test_a_whole_source_failing_is_recorded_against_every_candidate(
        self, database_url: str
    ) -> None:
        """It once left no trace: skipped for having no candidate, while the run said
        `completed`. OECD behind a browser challenge failed for every candidate it was asked
        about, and that is what the run records."""
        unreachable = a_stub_source(answers=(OVERBURDEN,), unreachable=True)
        async with an_api(database_url, (unreachable,)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert len(detail["failures"]) == 32
        assert detail["progress"]["items_failed"] == 32

    async def test_an_item_another_source_answered_is_complete_not_failed(
        self, database_url: str
    ) -> None:
        """Failed and completed never overlap. Eurostat declines Portugal on both attributes, and
        a second source answers Portugal's overcrowding: one item failed, and two failures are
        still listed, because Eurostat still failed on both and is still worth asking again."""
        overlapping = (
            a_stub_source(),
            a_stub_source(
                data_source="world_bank", answers=("country.overcrowding_rate",), silent_about=()
            ),
        )
        async with an_api(database_url, overlapping) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["progress"]["items_failed"] == 1
        assert detail["progress"]["items_completed"] == 32 * 2 - 1
        assert len(detail["failures"]) == 2


class TestRetryingARun:
    async def test_a_retry_is_a_new_run_over_only_what_failed(self, api: httpx.AsyncClient) -> None:
        first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        retried = await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")

        assert retried.status_code == 202
        assert retried.json()["id"] != first["id"]
        scope = (await api.get(f"/v1/data-acquisition-runs/{retried.json()['id']}")).json()["scope"]
        assert scope["candidates"] == [THE_STUB_DECLINES_FOR]
        assert sorted(scope["attributes"]) == [OVERBURDEN, "country.overcrowding_rate"]

    async def test_the_run_retried_keeps_its_record_of_what_went_wrong(
        self, api: httpx.AsyncClient
    ) -> None:
        first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
        before = (await api.get(f"/v1/data-acquisition-runs/{first['id']}")).json()["failures"]

        await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")

        after = (await api.get(f"/v1/data-acquisition-runs/{first['id']}")).json()["failures"]
        assert after == before

    async def test_only_the_source_that_failed_is_asked_again(self, database_url: str) -> None:
        """World Bank answered Portugal's overcrowding; only Eurostat failed. Asking World Bank
        again would store a figure nobody asked to refresh."""
        overlapping = (
            a_stub_source(),
            a_stub_source(
                data_source="world_bank", answers=("country.overcrowding_rate",), silent_about=()
            ),
        )
        async with an_api(database_url, overlapping) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            retried = (await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")).json()

            asked_again = await _count(
                database_url,
                "SELECT count(*) FROM value WHERE data_acquisition_run = %s"
                " AND data_source = 'world_bank'",
                retried["id"],
            )

        assert asked_again == 0

    async def test_a_source_is_asked_again_only_about_what_it_failed_on(
        self, database_url: str
    ) -> None:
        """Eurostat answers both attributes and failed on overburden only; World Bank failed on
        overcrowding. The retry covers both attributes for Portugal -- and Eurostat, which
        answered Portugal's overcrowding the first time, must not be asked about it again."""
        each_failing_on_one = (
            a_stub_source(silent_on=(OVERBURDEN,)),
            a_stub_source(data_source="world_bank", answers=("country.overcrowding_rate",)),
        )
        async with an_api(database_url, each_failing_on_one) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            retried = (await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{retried['id']}")).json()

            asked_again_about_overcrowding = await _count(
                database_url,
                "SELECT count(*) FROM value WHERE data_acquisition_run = %s"
                " AND data_source = 'eurostat' AND attribute = 'country.overcrowding_rate'",
                retried["id"],
            )

        assert sorted(detail["scope"]["attributes"]) == [OVERBURDEN, "country.overcrowding_rate"]
        assert asked_again_about_overcrowding == 0

    async def test_a_run_that_failed_on_nothing_has_nothing_to_retry(
        self, database_url: str
    ) -> None:
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            refused = await api.post(f"/v1/data-acquisition-runs/{run['id']}/retry")

        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_retry"

    async def test_retrying_a_run_that_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post("/v1/data-acquisition-runs/999999/retry")

        assert response.status_code == 404
