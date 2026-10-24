"""Data acquisition through the API: plan it, start it, watch it.

Gate A steps 4 and 5. Driven against a stub source rather than Eurostat -- what is under test is
the *run*: that it is recorded before anything is fetched, that values carry it, that failures
are kept rather than raised, and that progress can be polled. Eurostat's own behaviour is tested
where Eurostat lives, against captured responses.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data_acquisition import SourceAdapter
from starnest.storage import PostgresRunStore

from .conftest import A_SECOND_SOURCE_ANSWERS, a_stub_source, an_api
from .contract import validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
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

    async def test_an_attribute_fresh_for_every_candidate_is_not_planned(
        self, database_url: str
    ) -> None:
        """BE-25. With a refetch age set, a run skips an attribute every candidate already holds
        a fresh figure for (`reqs.md` 3.10) -- and the plan did not, so the estimate the
        household confirmed counted work the run then skipped."""
        both = {"level": COUNTRY, "attributes": [OVERBURDEN, OVERCROWDING]}
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            await api.put("/v1/settings", json={"refetch_older_than_days": 30})
            await api.post(
                "/v1/data-acquisition-runs", json={"level": COUNTRY, "attributes": [OVERBURDEN]}
            )

            planned = (await api.post("/v1/data-acquisition-runs/plan", json=both)).json()
            started = (await api.post("/v1/data-acquisition-runs", json=both)).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{started['id']}")).json()

        validate("planRun", planned)
        assert planned["items_total"] == detail["progress"]["items_total"] == 32
        assert planned["by_source"] == [{"data_source": "eurostat", "items": 32}]

    async def test_a_plan_of_nothing_but_fresh_attributes_plans_nothing_and_the_run_refuses(
        self, database_url: str
    ) -> None:
        """The two must agree at the edge too: a plan promising work the run then refuses as
        `nothing_to_fetch` is the same disagreement, at its largest."""
        only_overburden = {"level": COUNTRY, "attributes": [OVERBURDEN]}
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            await api.put("/v1/settings", json={"refetch_older_than_days": 30})
            await api.post("/v1/data-acquisition-runs", json=only_overburden)

            planned = (
                await api.post("/v1/data-acquisition-runs/plan", json=only_overburden)
            ).json()
            refused = await api.post("/v1/data-acquisition-runs", json=only_overburden)

        assert (planned["items_total"], planned["estimated_cost_eur"]) == (0, 0)
        assert planned["by_source"] == []
        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_fetch"

    async def test_a_fresh_paid_attribute_is_not_priced(self, database_url: str) -> None:
        """Where being wrong costs the most to believe: a fresh attribute the run will not ask
        a paid source about must not be in the money the household agrees to."""
        only_overburden = {"level": COUNTRY, "attributes": [OVERBURDEN]}
        async with an_api(database_url, (a_stub_source(silent_about=(), charges=True),)) as api:
            await api.put(
                "/v1/settings", json={"refetch_older_than_days": 30, "run_spend_cap_eur": 100}
            )
            before = (await api.post("/v1/data-acquisition-runs/plan", json=only_overburden)).json()
            await api.post("/v1/data-acquisition-runs", json=only_overburden)

            after = (await api.post("/v1/data-acquisition-runs/plan", json=only_overburden)).json()

        assert before["estimated_cost_eur"] > 0, "the source does charge, so the first plan prices"
        assert (after["llm_call_count"], after["estimated_cost_eur"]) == (0, 0)

    async def test_with_no_refetch_age_the_plan_counts_everything(self, database_url: str) -> None:
        """The control, and the shipped state: with no age set nothing is fresh, so a run just
        made changes nothing about the next plan."""
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            await api.post(
                "/v1/data-acquisition-runs", json={"level": COUNTRY, "attributes": [OVERBURDEN]}
            )

            planned = (
                await api.post(
                    "/v1/data-acquisition-runs/plan",
                    json={"level": COUNTRY, "attributes": [OVERBURDEN, OVERCROWDING]},
                )
            ).json()

        assert planned["items_total"] == 32 * 2

    async def test_a_source_with_two_adapters_is_one_row(self, database_url: str) -> None:
        """UI-33. OECD has an API and three transcribed tables, and the plan listed it once per
        adapter -- while a finished run's `by_source` is per source, and the Acquire screen keys
        its rows by source, so the keys repeated."""
        two_tables = (a_stub_source(), a_stub_source(answers=(A_SECOND_SOURCE_ANSWERS,)))
        async with an_api(database_url, two_tables) as api:
            planned = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()

        assert planned["by_source"] == [{"data_source": "eurostat", "items": 96}]
        assert planned["items_total"] == 96

    async def test_each_adapter_still_prices_its_own_share(self, database_url: str) -> None:
        """The rows are summed per source and the money is not: each adapter is the only thing
        that knows what it charges, so two adapters of one source at two prices cost the sum of
        their own estimates."""
        two_prices = (
            a_stub_source(silent_about=(), charges=True, eur_per_call="0.05"),
            a_stub_source(answers=(A_SECOND_SOURCE_ANSWERS,), charges=True, eur_per_call="0.10"),
        )
        async with an_api(database_url, two_prices) as api:
            planned = (
                await api.post(
                    "/v1/data-acquisition-runs/plan",
                    json={
                        "level": COUNTRY,
                        "attributes": [OVERBURDEN, OVERCROWDING, A_SECOND_SOURCE_ANSWERS],
                    },
                )
            ).json()

        assert planned["llm_call_count"] == 96
        assert planned["estimated_cost_eur"] == pytest.approx(64 * 0.05 + 32 * 0.10)


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


class TestARunOfNothingButFreshFigures:
    """The refusal names the age the household set, as the household set it (NEW-37).

    The age travels as an interval, and an interval printed as itself reads "30 days, 0:00:00"
    -- a clock time nobody set, in a sentence telling somebody which setting to lower.
    """

    @pytest.mark.parametrize(
        ("days", "said"), [(30, "30 days"), (1, "1 day")], ids=["thirty days", "one day"]
    )
    async def test_the_age_reads_in_whole_days(
        self, database_url: str, days: int, said: str
    ) -> None:
        only_overburden = {"level": COUNTRY, "attributes": [OVERBURDEN]}
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            await api.put("/v1/settings", json={"refetch_older_than_days": days})
            await api.post("/v1/data-acquisition-runs", json=only_overburden)

            refused = await api.post("/v1/data-acquisition-runs", json=only_overburden)

        assert refused.json()["code"] == "nothing_to_fetch"
        message = refused.json()["message"]
        assert f"fetched within the last {said}, so there is nothing" in message, message
        assert "0:00:00" not in message


class TestAScopeThatNamesSomethingUnknown:
    """BE-24. A misspelled candidate or an id from another level used to fall out of the
    intersection with what exists, and the run proceeded on the rest -- fetching, and where a
    source charges, spending, for less than was asked while concealing the drop. Now the request
    is refused and every unknown id is named, so a client fixes it in one pass."""

    async def test_planning_refuses_an_unknown_candidate_and_names_only_it(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={"level": COUNTRY, "candidates": ["country.greece", "country.narnia"]},
        )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "unknown_scope"
        assert body["details"]["unknown_candidates"] == ["country.narnia"]

    async def test_starting_refuses_an_unknown_candidate_before_it_fetches(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs",
            json={"level": COUNTRY, "candidates": ["country.narnia"]},
        )

        assert response.status_code == 422
        assert response.json()["code"] == "unknown_scope"

    async def test_an_unknown_attribute_is_named(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={"level": COUNTRY, "attributes": ["country.unicorn_density"]},
        )

        assert response.status_code == 422
        assert response.json()["details"]["unknown_attributes"] == ["country.unicorn_density"]

    async def test_unknowns_from_both_dimensions_are_reported_together(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={
                "level": COUNTRY,
                "candidates": ["country.narnia"],
                "attributes": ["country.unicorn_density"],
            },
        )

        assert response.status_code == 422
        details = response.json()["details"]
        assert details["unknown_candidates"] == ["country.narnia"]
        assert details["unknown_attributes"] == ["country.unicorn_density"]

    async def test_a_scope_of_only_known_ids_still_plans(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={"level": COUNTRY, "candidates": ["country.greece"], "attributes": [OVERBURDEN]},
        )

        assert response.status_code == 200

    async def test_planning_refuses_an_unknown_level(self, api: httpx.AsyncClient) -> None:
        """NEW-40. A level nothing is catalogued at planned nothing and answered 200, while
        starting the same scope was refused -- the plan and the run disagreeing about one
        request, on the one level a client can mistype."""
        response = await api.post("/v1/data-acquisition-runs/plan", json={"level": "atlantis"})

        assert response.status_code == 422, f"answered {response.status_code}: {response.text}"
        body = response.json()
        assert body["code"] == "unknown_scope"
        assert body["details"] == {"level": "atlantis", "unknown_levels": ["atlantis"]}
        validate("planRun", body, status=422)

    async def test_starting_refuses_an_unknown_level_as_planning_does(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post("/v1/data-acquisition-runs", json={"level": "atlantis"})

        assert response.status_code == 422, f"answered {response.status_code}: {response.text}"
        assert response.json()["code"] == "unknown_scope"
        validate("startRun", response.json(), status=422)
        runs = (await api.get("/v1/data-acquisition-runs")).json()
        assert runs["total"] == 0, "nothing ran"

    async def test_an_unknown_level_is_named_with_every_id_named_at_it(
        self, api: httpx.AsyncClient
    ) -> None:
        """Nothing exists at a level that does not, so every id the scope names is unknown too,
        and all of them are named at once, as the other dimensions are."""
        response = await api.post(
            "/v1/data-acquisition-runs/plan",
            json={
                "level": "atlantis",
                "candidates": ["country.greece"],
                "attributes": [OVERBURDEN],
            },
        )

        assert response.status_code == 422
        details = response.json()["details"]
        assert details["unknown_levels"] == ["atlantis"]
        assert details["unknown_candidates"] == ["country.greece"]
        assert details["unknown_attributes"] == [OVERBURDEN]

    async def test_a_catalogued_level_with_nothing_to_fetch_still_plans(
        self, api: httpx.AsyncClient
    ) -> None:
        """The control: `city` exists and no source answers it yet, which is a plan of nothing
        rather than a scope naming something unknown."""
        response = await api.post("/v1/data-acquisition-runs/plan", json={"level": "city"})

        assert response.status_code == 200
        assert response.json()["items_total"] == 0


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

    async def test_a_page_asked_for_no_size_holds_the_hundred_the_contract_declares(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """NEW-13. `openapi.yaml` gives `limit` a default of 100 and the server used 20, so a
        client trusting the contract saw a fifth of a long history with nothing saying so."""
        await _finished_runs(database_url, 101)

        page = (await api.get("/v1/data-acquisition-runs")).json()

        validate("listRuns", page)
        assert (len(page["items"]), page["total"]) == (100, 101)


async def _finished_runs(database_url: str, count: int) -> None:
    """Run rows written straight to the store: a history this long through the API would fetch
    6,464 figures to test a page size."""
    from datetime import UTC, datetime

    from starnest.data_acquisition import RunScope, RunStatus

    async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
        await pool.open(wait=True)
        store = PostgresRunStore(pool)
        for _ in range(count):
            run = await store.start_run(
                RunScope(
                    level=COUNTRY, candidates=(THE_STUB_DECLINES_FOR,), attributes=(OVERBURDEN,)
                ),
                triggered_by="user",
            )
            await store.finish_run(run, status=RunStatus.COMPLETED, finished_at=datetime.now(UTC))


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
TAX = "country.total_tax_rate_effective"
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

    async def test_a_figure_outside_its_credible_range_can_be_retried(
        self, database_url: str
    ) -> None:
        """BE-08, `reqs.md` 3.3a. 62 °C for Portugal's annual mean is stored and never scored,
        and nothing made it a failure -- so the run listed no failure and a retry answered 409
        `nothing_to_retry` about the one figure it should go back to."""
        async with an_api(database_url, (_a_source_misreading(THE_STUB_DECLINES_FOR),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
            retried = await api.post(f"/v1/data-acquisition-runs/{run['id']}/retry")

        validate("getRun", detail)
        (failure,) = detail["failures"]
        assert (failure["data_source"], failure["candidate"], failure["attribute"]) == (
            "open_meteo",
            THE_STUB_DECLINES_FOR,
            TEMPERATURE,
        )
        assert "outside the credible range" in failure["error_message"]
        assert retried.status_code == 202
        validate("retryRun", retried.json(), status=202)

    async def test_a_rejected_figure_still_counts_as_completed_not_failed(
        self, database_url: str
    ) -> None:
        """The household's choice for BE-08: a pair whose figure arrived and was rejected was
        answered, and `items_completed` counts answered pairs, as the contract defines it. The
        failure beside it is what a retry reaches."""
        async with an_api(database_url, (_a_source_misreading(THE_STUB_DECLINES_FOR),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            progress = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()["progress"]

        assert (progress["items_completed"], progress["items_failed"]) == (32, 0)
        assert (
            progress["items_completed"] + progress["items_failed"] + progress["items_unanswered"]
            == progress["items_total"]
        )

    async def test_a_rejected_figure_counts_for_its_source_as_a_failure_not_as_stored(
        self, database_url: str
    ) -> None:
        """A rejected figure contributed nothing, so source by source it is the failure and
        not a figure stored. Counted as both, the Acquire screen's bar -- stored plus failed --
        read 32 of 33 for a source that was asked 32 items."""
        async with an_api(database_url, (_a_source_misreading(THE_STUB_DECLINES_FOR),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        validate("getRun", detail)
        assert detail["by_source"] == [
            {"data_source": "open_meteo", "items_stored": 32 - 1, "items_failed": 1}
        ]


TEMPERATURE = "country.avg_annual_temperature"


def _a_source_misreading(candidate_id: str) -> SourceAdapter:
    """A source reading 62 °C as one country's annual mean -- a scraper on the wrong column --
    and a credible 15 °C everywhere else. The catalog declares -20..40 for the attribute, and
    `Measurements` applies it, as every adapter's figures go through it."""
    from collections.abc import Sequence
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.candidates import Candidate
    from starnest.data import (
        Attribute,
        DataSourceId,
        Measurements,
        Quantity,
        ReferencePeriod,
    )
    from starnest.data_acquisition import Acquired

    class MisreadingSource(SourceAdapter):
        @property
        def data_source(self) -> DataSourceId:
            return DataSourceId("open_meteo")

        @property
        def attributes(self) -> tuple:
            return (TEMPERATURE,)

        async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
            assert attribute.quantity_parameters is not None
            measuring = Measurements(
                attribute=attribute, data_source="open_meteo", retrieved=datetime.now(UTC)
            )
            return Acquired(
                values=tuple(
                    measuring.figure(
                        candidate=candidate,
                        payload=Quantity(
                            magnitude=Decimal("62" if str(candidate.id) == candidate_id else "15"),
                            unit=attribute.quantity_parameters.unit,
                        ),
                        period=ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31)),
                    )
                    for candidate in candidates
                )
            )

    return MisreadingSource()


def _a_transcribed_table(
    portugal_reads: tuple[str, ...], *, portugal_again: str | None = None
) -> SourceAdapter:
    """A transcribed table: every figure stamped with one fixed `transcribed_on`, as
    `published_tables` stamps them, so each read is the same observation. Portugal's figure is
    the next of `portugal_reads` each time the table is read -- a correction typed in without a
    new date (NEW-23). `portugal_again` is a second row for Portugal in the same read, as a table
    with a duplicated country row carries it."""
    from collections.abc import Sequence
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.candidates import Candidate
    from starnest.data import Attribute, DataSourceId, Measurements, Quantity, ReferencePeriod
    from starnest.data_acquisition import Acquired

    readings = iter(portugal_reads)

    class TranscribedTable(SourceAdapter):
        @property
        def data_source(self) -> DataSourceId:
            return DataSourceId("open_meteo")

        @property
        def attributes(self) -> tuple:
            return (TEMPERATURE,)

        async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
            assert attribute.quantity_parameters is not None
            portugal = next(readings)
            rows = [(candidate, portugal) for candidate in candidates]
            rows += [
                (candidate, portugal_again)
                for candidate in candidates
                if portugal_again is not None and str(candidate.id) == THE_STUB_DECLINES_FOR
            ]
            measuring = Measurements(
                attribute=attribute,
                data_source="open_meteo",
                retrieved=datetime(2026, 9, 19, tzinfo=UTC),
            )
            return Acquired(
                values=tuple(
                    measuring.figure(
                        candidate=candidate,
                        payload=Quantity(
                            magnitude=Decimal(
                                reading if str(candidate.id) == THE_STUB_DECLINES_FOR else "15"
                            ),
                            unit=attribute.quantity_parameters.unit,
                        ),
                        period=ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31)),
                    )
                    for candidate, reading in rows
                )
            )

    return TranscribedTable()


class TestATableCorrectedUnderItsOldDate:
    """NEW-23. A re-read under the same natural key with another figure was a silent no-op, and
    the run then credited the source with re-confirming the figure it had contradicted."""

    async def test_a_corrected_table_under_its_old_date_is_reported_failed(
        self, database_url: str
    ) -> None:
        a_temperature_run = {"level": COUNTRY, "attributes": [TEMPERATURE]}
        async with an_api(database_url, (_a_transcribed_table(("16", "17")),)) as api:
            first = await api.post("/v1/data-acquisition-runs", json=a_temperature_run)
            second = await api.post("/v1/data-acquisition-runs", json=a_temperature_run)
            assert (first.status_code, second.status_code) == (202, 202), second.text
            detail = (await api.get(f"/v1/data-acquisition-runs/{second.json()['id']}")).json()
            stored = (
                await api.get(
                    "/v1/values",
                    params={"candidate": THE_STUB_DECLINES_FOR, "attribute": TEMPERATURE},
                )
            ).json()["items"]

        validate("getRun", detail)
        (failure,) = detail["failures"]
        assert (failure["data_source"], failure["candidate"]) == (
            "open_meteo",
            THE_STUB_DECLINES_FOR,
        )
        assert "a different figure is already on record" in failure["error_message"]
        assert (detail["progress"]["items_completed"], detail["progress"]["items_failed"]) == (
            31,
            1,
        )
        assert [value["payload"]["magnitude"] for value in stored] == [16]

    async def test_two_figures_for_one_new_observation_in_one_read_are_reported_failed(
        self, database_url: str
    ) -> None:
        """Nothing was on record before the read, so only the batch itself can tell: the first
        row is stored and the second, different one is the conflict -- never a silent drop."""
        a_temperature_run = {"level": COUNTRY, "attributes": [TEMPERATURE]}
        async with an_api(
            database_url, (_a_transcribed_table(("16",), portugal_again="17"),)
        ) as api:
            run = await api.post("/v1/data-acquisition-runs", json=a_temperature_run)
            detail = (await api.get(f"/v1/data-acquisition-runs/{run.json()['id']}")).json()
            stored = (
                await api.get(
                    "/v1/values",
                    params={"candidate": THE_STUB_DECLINES_FOR, "attribute": TEMPERATURE},
                )
            ).json()["items"]

        (failure,) = detail["failures"]
        assert failure["candidate"] == THE_STUB_DECLINES_FOR
        assert "a different figure is already on record" in failure["error_message"]
        assert [value["payload"]["magnitude"] for value in stored] == [16]

    async def test_a_table_read_again_unchanged_is_re_confirmed(self, database_url: str) -> None:
        """The control: the same figures under the same date are every pair completed."""
        a_temperature_run = {"level": COUNTRY, "attributes": [TEMPERATURE]}
        async with an_api(database_url, (_a_transcribed_table(("16", "16")),)) as api:
            await api.post("/v1/data-acquisition-runs", json=a_temperature_run)
            second = (await api.post("/v1/data-acquisition-runs", json=a_temperature_run)).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{second['id']}")).json()

        assert detail["failures"] == []
        assert detail["progress"]["items_completed"] == 32


@asynccontextmanager
async def _a_refetch_age(api: httpx.AsyncClient, *, days: int) -> AsyncIterator[None]:
    """The refetch age set for as long as a test needs it, and the settings put back after."""
    before = (await api.get("/v1/settings")).json()
    changed = await api.put("/v1/settings", json={**before, "refetch_older_than_days": days})
    assert changed.status_code == 200, changed.text
    try:
        yield
    finally:
        await api.put("/v1/settings", json=before)


@asynccontextmanager
async def _an_api_after_a_rejection(database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """A 30-day refetch age, and a run that rejected Portugal's figure and accepted every other
    country's -- so the one thing setting Portugal's pair apart from Spain's is the rejection."""
    async with (
        an_api(database_url, (_a_source_misreading(THE_STUB_DECLINES_FOR),)) as api,
        _a_refetch_age(api, days=30),
    ):
        first = await api.post(
            "/v1/data-acquisition-runs", json={"level": COUNTRY, "attributes": [TEMPERATURE]}
        )
        assert first.status_code == 202, first.text
        yield api


class TestARejectedFigureIsNotFresh:
    """NEW-27. BE-08 records a rejected figure as a failure precisely so it can be asked about
    again, and its retrieval date still made the pair look fresh: with a refetch age set, a plan
    scoped to it counted nothing and the run was refused as `nothing_to_fetch`."""

    async def test_a_plan_and_a_run_scoped_to_the_rejected_pair_ask_about_it_again(
        self, database_url: str
    ) -> None:
        the_pair = {
            "level": COUNTRY,
            "candidates": [THE_STUB_DECLINES_FOR],
            "attributes": [TEMPERATURE],
        }
        async with _an_api_after_a_rejection(database_url) as api:
            planned = (await api.post("/v1/data-acquisition-runs/plan", json=the_pair)).json()
            started = await api.post("/v1/data-acquisition-runs", json=the_pair)

        assert (planned["items_total"], started.status_code) == (1, 202), started.text
        assert planned["by_source"] == [{"data_source": "open_meteo", "items": 1}]
        validate("planRun", planned)
        validate("startRun", started.json(), status=202)

    async def test_a_sweep_asks_about_the_attribute_again_for_every_candidate(
        self, database_url: str
    ) -> None:
        """A run's scope is a rectangle (`freshness.py`): one pair that is not fresh keeps its
        attribute in scope everywhere, which is what the household's next sweep meets."""
        async with _an_api_after_a_rejection(database_url) as api:
            planned = (
                await api.post(
                    "/v1/data-acquisition-runs/plan",
                    json={"level": COUNTRY, "attributes": [TEMPERATURE]},
                )
            ).json()

        assert planned["items_total"] == 32

    async def test_a_pair_answered_in_the_same_run_is_still_fresh(self, database_url: str) -> None:
        """The control: the refetch age still skips an accepted figure, so what makes
        Portugal's pair worth asking about again is its rejection and nothing else."""
        the_pair = {"level": COUNTRY, "candidates": ["country.spain"], "attributes": [TEMPERATURE]}
        async with _an_api_after_a_rejection(database_url) as api:
            planned = (await api.post("/v1/data-acquisition-runs/plan", json=the_pair)).json()
            refused = await api.post("/v1/data-acquisition-runs", json=the_pair)

        assert planned["items_total"] == 0
        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_fetch"


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

    async def test_a_source_the_household_switched_off_is_not_asked_again(
        self, database_url: str
    ) -> None:
        """**A retry consults the same sources a fresh run would** (P65).

        `start` and `plan` both filter through `switched_on`; this endpoint passed the raw
        registry, so a source switched off in Configure was asked again anyway -- and the same
        switch keeps its figures out of the active-value comparison, so the work could not
        score. For a source that charges, the retry billed for it.
        """
        both = (
            a_stub_source(silent_on=(OVERBURDEN,)),
            a_stub_source(data_source="world_bank", answers=("country.overcrowding_rate",)),
        )
        async with an_api(database_url, both) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": False})

            retried = (await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")).json()

            # **Counted from the failure rows, not the value rows.** The switched-off source
            # declines Portugal, so it stores nothing whether or not it was asked -- a count of
            # values is zero either way and proves nothing. A failure row is written only by a
            # source that was actually consulted.
            asked_again = await _count(
                database_url,
                "SELECT count(*) FROM data_acquisition_failure"
                " WHERE data_acquisition_run = %s AND data_source = 'world_bank'",
                retried["id"],
            )
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": True})

        assert asked_again == 0

    async def test_a_switched_off_source_s_failures_are_not_items_of_the_retry(
        self, database_url: str
    ) -> None:
        """FU-A2 (PL-043). Eurostat failed on Portugal's overburden rate, OECD on Spain's
        overcrowding, and World Bank -- since switched off -- on Spain's overburden rate. That
        last pair is a corner of the other two, and nobody's to ask about again: recorded as an
        item, it was reported unanswered by a retry that never asked anyone about it."""
        each_failing_on_one_pair = (
            a_stub_source(silent_on=(OVERBURDEN,)),
            a_stub_source(
                data_source="oecd", answers=(OVERCROWDING,), silent_about=("country.spain",)
            ),
            a_stub_source(
                data_source="world_bank", answers=(OVERBURDEN,), silent_about=("country.spain",)
            ),
        )
        async with an_api(database_url, each_failing_on_one_pair) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": False})

            retried = (await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{retried['id']}")).json()
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": True})

        assert detail["progress"]["items_total"] == 2
        assert detail["unanswered"] == []

    async def test_a_retry_only_switched_off_sources_could_answer_is_refused_truthfully(
        self, database_url: str
    ) -> None:
        """FU-A2 (PL-043). Only World Bank failed, and it is switched off; Eurostat is on. The
        refusal used to say that no data source was switched on."""
        only_world_bank_fails = (
            a_stub_source(silent_about=()),
            a_stub_source(data_source="world_bank", answers=(OVERBURDEN,)),
        )
        async with an_api(database_url, only_world_bank_fails) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": False})

            refused = await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")
            runs = (await api.get("/v1/data-acquisition-runs")).json()["total"]
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": True})

        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_fetch"
        assert "no data source is switched on" not in refused.json()["message"]
        assert runs == 1

    async def test_a_source_the_household_switched_off_is_not_asked_at_all(
        self, database_url: str
    ) -> None:
        """**The same filter, at the other two call sites.**

        `switched_on` guards three endpoints -- `plan`, `start` and `retry` -- and only the
        retry had a test. Bypassing it at `plan` alone left the whole suite green, and so did
        bypassing it at `start`. The docstring above this one asserts "start and plan both
        filter through `switched_on`" as a settled fact, which is exactly the kind of claim
        that stops being true quietly.

        Switched off before anything runs, because that is the household's own order of
        operations: the switch is thrown in Configure and then a run is started.
        """
        both = (
            a_stub_source(silent_on=(OVERBURDEN,)),
            a_stub_source(data_source="world_bank", answers=("country.overcrowding_rate",)),
        )
        async with an_api(database_url, both) as api:
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": False})

            started = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            # Counted from failure rows for the reason the retry test gives: a switched-off
            # source stores nothing whether or not it was asked, so a count of values is zero
            # either way. A failure row is written only by a source that was consulted.
            asked = await _count(
                database_url,
                "SELECT count(*) FROM data_acquisition_failure"
                " WHERE data_acquisition_run = %s AND data_source = 'world_bank'",
                started["id"],
            )
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": True})

        assert asked == 0

    async def test_an_estimate_does_not_price_a_source_the_household_switched_off(
        self, database_url: str
    ) -> None:
        """The third call site, and the one where being wrong costs the most to believe: an
        estimate naming a source nobody will ask quotes work that is never done, so the figure
        the household agrees to spend against is for a different run than the one that happens.
        """
        both = (
            a_stub_source(silent_on=(OVERBURDEN,)),
            a_stub_source(data_source="world_bank", answers=("country.overcrowding_rate",)),
        )
        async with an_api(database_url, both) as api:
            with_both = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()
            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": False})

            planned = (
                await api.post("/v1/data-acquisition-runs/plan", json={"level": COUNTRY})
            ).json()

            await api.patch("/v1/data-sources/world_bank", json={"is_enabled": True})

        priced = {each["data_source"] for each in planned["by_source"]}
        assert "world_bank" not in priced
        # And the switch actually changed the estimate, rather than the source never being in it.
        assert "world_bank" in {each["data_source"] for each in with_both["by_source"]}

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


class TestARetryBorrowsOnlyForItsOwnPairs:
    async def test_it_counts_no_more_than_it_asked_about(self, database_url: str) -> None:
        """FU-A1 (PL-042), on the seeded declarations: Switzerland stands in for Liechtenstein's
        prices and tax rate (`0460`). Eurostat fails on Liechtenstein's prices and OECD on
        Portugal's tax rate, so the retry asks about those two pairs -- and the borrow step,
        reading the rectangle they span, also lent Liechtenstein's tax rate under the retry. The
        run read "3 of 2": two pairs answered by borrowing, and Portugal's still failing."""
        sources = (
            a_stub_source(
                answers=(PRICES, TAX), silent_about=(LIECHTENSTEIN,), silent_on=(PRICES,)
            ),
            a_stub_source(data_source="oecd", answers=(TAX,)),
        )
        async with an_api(database_url, sources) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            retried = (await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")).json()
            progress = (await api.get(f"/v1/data-acquisition-runs/{retried['id']}")).json()[
                "progress"
            ]
            written_for_a_pair_nobody_asked_about = await _count(
                database_url,
                "SELECT (SELECT count(*) FROM value"
                "        WHERE data_acquisition_run = %s AND candidate = %s AND attribute = %s)"
                "     + (SELECT count(*) FROM data_acquisition_failure"
                "        WHERE data_acquisition_run = %s AND candidate = %s AND attribute = %s)",
                retried["id"],
                LIECHTENSTEIN,
                TAX,
                retried["id"],
                LIECHTENSTEIN,
                TAX,
            )

        assert progress["items_total"] == 2
        assert (
            progress["items_completed"] + progress["items_failed"] + progress["items_unanswered"]
            == progress["items_total"]
        )
        assert written_for_a_pair_nobody_asked_about == 0


NO_SOURCE_COVERS = "country.liechtenstein"


class TestHowBigThePassWas:
    async def test_the_detail_and_the_list_agree_on_the_scope(self, database_url: str) -> None:
        """A detail that reported a scope of nothing while listing its candidates by name would
        disagree with itself, and with its own row in the history."""
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()
            listed = (await api.get("/v1/data-acquisition-runs?limit=1")).json()["items"][0]

        assert detail["scope_candidates"] == len(detail["scope"]["candidates"]) == 32
        assert detail["scope_attributes"] == len(detail["scope"]["attributes"])
        assert detail["scope_candidates"] == listed["scope_candidates"]
        assert detail["scope_attributes"] == listed["scope_attributes"]


class TestWhichSourceGotItThere:
    """`RunDetail.by_source`. A run's totals say how far it got, not which source got it there.

    **Derived from the value and failure rows**, never stored -- the reason Q217 settled for
    `items_unanswered`: a second record of the same arithmetic can disagree with the first.
    """

    async def test_each_source_reports_what_it_stored_and_what_it_failed_on(
        self, database_url: str
    ) -> None:
        # One source answers everything, the other declines on one country -- the shipped
        # shape, with OECD's Cloudflare-challenged front door.
        working = a_stub_source(silent_about=())
        broken = a_stub_source(data_source="oecd", silent_about=("country.portugal",))
        async with an_api(database_url, (working, broken)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        reach = {r["data_source"]: r for r in detail["by_source"]}
        assert reach["eurostat"]["items_stored"] == 32 * 2
        assert reach["eurostat"]["items_failed"] == 0
        # The source that broke is listed with what it broke on, which is what a retry needs.
        assert reach["oecd"]["items_failed"] == 2
        # And the run itself is complete: the working source answered every item the other
        # failed on, so a failure here is not a gap in the corpus.
        assert detail["progress"]["items_failed"] == 0

    async def test_a_source_that_re_read_its_figures_is_credited_with_them(
        self, database_url: str
    ) -> None:
        """NEW-54. A transcribed table re-read is the same observation (ST-09): the second run
        stores nothing new and re-confirms every pair instead. Its totals count those pairs
        answered, so its breakdown has to credit the source that re-read them -- or a run shows
        every pair answered beside a breakdown with nobody in it."""
        from datetime import UTC, datetime

        transcribed = a_stub_source(silent_about=(), retrieved=datetime(2026, 10, 11, tzinfo=UTC))
        async with an_api(database_url, (transcribed,)) as api:
            first = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})
            assert first.status_code == 202, first.text
            again = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{again['id']}")).json()

        assert detail["progress"]["items_completed"] == 32 * 2, "the premise: all re-confirmed"
        assert {
            r["data_source"]: (r["items_stored"], r["items_failed"]) for r in detail["by_source"]
        } == {"eurostat": (32 * 2, 0)}
        validate("getRun", detail)

    async def test_every_entry_names_a_source_and_carries_both_counts(
        self, database_url: str
    ) -> None:
        """No entry may report one count and leave the other out. A source with a stored count
        and no failure count reads as a source that cannot fail, which is never true."""
        async with an_api(database_url, (a_stub_source(silent_about=()),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["by_source"]
        assert all(
            set(entry) == {"data_source", "items_stored", "items_failed"}
            for entry in detail["by_source"]
        )


class TestWhatNobodyAnswered:
    """`reqs.md` Q217. An item every source answered without having a row for that candidate.

    It is not a failure -- nothing broke -- and it is not complete. Before the third count it
    belonged to neither, so a run that learned nothing about a country reported that nothing had
    failed.
    """

    async def test_the_three_counts_sum_to_the_total(self, database_url: str) -> None:
        omitting = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        async with an_api(database_url, (omitting,)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            progress = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()["progress"]

        assert progress["items_total"] == 32 * 2
        assert progress["items_completed"] == 31 * 2
        assert progress["items_failed"] == 0
        assert progress["items_unanswered"] == 2
        assert (
            progress["items_completed"] + progress["items_failed"] + progress["items_unanswered"]
            == progress["items_total"]
        )

    async def test_the_items_are_named_so_they_can_be_asked_again(self, database_url: str) -> None:
        omitting = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        async with an_api(database_url, (omitting,)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert {item["candidate"] for item in detail["unanswered"]} == {NO_SOURCE_COVERS}
        assert {item["attribute"] for item in detail["unanswered"]} == {
            OVERBURDEN,
            "country.overcrowding_rate",
        }

    async def test_an_item_a_second_source_answered_is_complete_not_unanswered(
        self, database_url: str
    ) -> None:
        """Neither count overlaps `items_completed`: Eurostat omits Liechtenstein's overcrowding
        and the World Bank answers it, so that item was answered."""
        one_omitting = (
            a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,)),
            a_stub_source(
                data_source="world_bank",
                answers=("country.overcrowding_rate",),
                silent_about=(),
            ),
        )
        async with an_api(database_url, one_omitting) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["progress"]["items_unanswered"] == 1
        assert [item["attribute"] for item in detail["unanswered"]] == [OVERBURDEN]

    async def test_a_failure_is_not_counted_as_unanswered(self, api: httpx.AsyncClient) -> None:
        """The default stub declines for Portugal, which is a failure and nothing else."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["progress"]["items_failed"] == 2
        assert detail["progress"]["items_unanswered"] == 0
        assert detail["unanswered"] == []


class TestAskingAgain:
    """The second action on a run: ask again about what nobody answered (`reqs.md` Q217)."""

    async def test_it_is_a_new_run_over_only_the_unanswered_items(self, database_url: str) -> None:
        omitting = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        async with an_api(database_url, (omitting,)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            asked = await api.post(
                f"/v1/data-acquisition-runs/{first['id']}/retry", json={"items": "unanswered"}
            )
            scope = (await api.get(f"/v1/data-acquisition-runs/{asked.json()['id']}")).json()[
                "scope"
            ]

        assert asked.status_code == 202
        assert asked.json()["id"] != first["id"]
        assert scope["candidates"] == [NO_SOURCE_COVERS]

    async def test_a_source_that_never_failed_is_asked_again(self, database_url: str) -> None:
        """**The difference from a retry.** Nothing failed, so there is no source to narrow to:
        both sources had nothing for Liechtenstein the first time, and both are asked again --
        which is how a figure that has since been published can arrive at all."""
        stubborn = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        relenting = _a_source_that_answers_the_second_time()
        async with an_api(database_url, (stubborn, relenting)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            unanswered_first = (await api.get(f"/v1/data-acquisition-runs/{first['id']}")).json()[
                "progress"
            ]["items_unanswered"]

            asked = (
                await api.post(
                    f"/v1/data-acquisition-runs/{first['id']}/retry", json={"items": "unanswered"}
                )
            ).json()

            from_the_second_source = await _count(
                database_url,
                "SELECT count(*) FROM value WHERE data_acquisition_run = %s"
                " AND data_source = 'world_bank' AND candidate = %s",
                asked["id"],
                NO_SOURCE_COVERS,
            )

        # Both attributes for Liechtenstein: the first source omits it on both, and the second
        # declares only one of them and had nothing that time either.
        assert unanswered_first == 2
        assert from_the_second_source == 1

    async def test_the_earlier_run_keeps_its_account_of_what_it_asked(
        self, database_url: str
    ) -> None:
        omitting = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        async with an_api(database_url, (omitting,)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            before = (await api.get(f"/v1/data-acquisition-runs/{first['id']}")).json()

            await api.post(
                f"/v1/data-acquisition-runs/{first['id']}/retry", json={"items": "unanswered"}
            )

            after = (await api.get(f"/v1/data-acquisition-runs/{first['id']}")).json()

        assert after["unanswered"] == before["unanswered"]
        assert after["progress"] == before["progress"]

    async def test_a_second_silence_stores_nothing_and_invents_nothing(
        self, database_url: str
    ) -> None:
        """The honest outcome for a country a dataset does not cover."""
        omitting = a_stub_source(silent_about=(), no_row_for=(NO_SOURCE_COVERS,))
        async with an_api(database_url, (omitting,)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            asked = (
                await api.post(
                    f"/v1/data-acquisition-runs/{first['id']}/retry", json={"items": "unanswered"}
                )
            ).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{asked['id']}")).json()

        assert detail["progress"]["items_completed"] == 0
        assert detail["progress"]["items_unanswered"] == 2

    async def test_a_run_with_nothing_unanswered_is_refused(self, api: httpx.AsyncClient) -> None:
        """A new run over an empty scope would be a no-op recorded as though it were work."""
        run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        refused = await api.post(
            f"/v1/data-acquisition-runs/{run['id']}/retry", json={"items": "unanswered"}
        )

        assert refused.status_code == 409
        assert refused.json()["code"] == "nothing_to_ask_again"

    async def test_asking_again_about_a_run_that_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/data-acquisition-runs/999999/retry", json={"items": "unanswered"}
        )

        assert response.status_code == 404

    async def test_a_body_naming_no_kind_still_retries_the_failures(
        self, api: httpx.AsyncClient
    ) -> None:
        """The default is what the endpoint always did, so an older client keeps working."""
        first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        retried = await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry", json={})

        assert retried.status_code == 202
        scope = (await api.get(f"/v1/data-acquisition-runs/{retried.json()['id']}")).json()["scope"]
        assert scope["candidates"] == [THE_STUB_DECLINES_FOR]


def _a_source_that_answers_the_second_time() -> SourceAdapter:
    """A source with no row for Liechtenstein on the first ask and one on the second.

    Stateful on purpose, and it is the only stub here that is: what "ask again" is *for* is the
    case where the answer has since appeared, and a stub that behaved identically both times
    could not tell asking again from not bothering.
    """
    from collections.abc import Sequence
    from datetime import UTC, date, datetime
    from decimal import Decimal

    from starnest.candidates import Candidate
    from starnest.data import (
        Attribute,
        ConfidenceLevel,
        DataSourceId,
        Ratio,
        ReferencePeriod,
        Value,
    )
    from starnest.data_acquisition import Acquired

    class RelentingSource(SourceAdapter):
        def __init__(self) -> None:
            self._asked = 0

        @property
        def data_source(self) -> DataSourceId:
            return DataSourceId("world_bank")

        @property
        def attributes(self) -> tuple:
            return (OVERBURDEN,)

        async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
            self._asked += 1
            if self._asked == 1:
                return Acquired()
            return Acquired(
                values=tuple(
                    Value(
                        candidate=candidate.id,
                        attribute=attribute.id,
                        value_type=attribute.value_type,
                        data_source="world_bank",
                        reference_period=ReferencePeriod(
                            start=date(2025, 1, 1), end=date(2025, 12, 31)
                        ),
                        retrieval_date=datetime.now(UTC),
                        confidence_level=ConfidenceLevel.HIGH,
                        payload=Ratio(value=Decimal("5.1"), basis="households"),
                    )
                    for candidate in candidates
                )
            )

    return RelentingSource()


class TestOnlyOneRunAtATime:
    """**A second run while one is in flight is refused** (P35).

    The rule is already written down: `sweep_abandoned_runs` says "nothing else starts a run
    (`reqs.md` 10), so a run in flight at boot is one whose process died". Nothing enforced it.

    That is what made the 2.70 EUR mistake possible. `POST /data-acquisition-runs` answers 202
    and then blocks for the whole run, so a 40-second client timeout is indistinguishable from
    a failure -- and the obvious response to a failure is to try again, which started a second
    paid run beside the first. Both were killed; neither finished; nothing was stored.
    """

    @staticmethod
    async def a_run_left_in_flight(database_url: str) -> int:
        """A `running` row, which is what a run genuinely in flight looks like."""
        from starnest.data_acquisition import RunScope
        from starnest.storage import PostgresRunStore

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            return await PostgresRunStore(pool).start_run(
                RunScope(level=COUNTRY, candidates=("country.portugal",), attributes=(OVERBURDEN,)),
                triggered_by="a run that is still going",
            )

    async def test_a_second_start_is_refused_while_one_is_running(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        in_flight = await self.a_run_left_in_flight(database_url)

        refused = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert refused.status_code == 409
        assert refused.json()["code"] == "run_already_in_flight"
        # Naming it is the point: the client's next move is to poll that run, not to try again.
        assert str(in_flight) in refused.json()["message"]

    async def test_a_retry_is_refused_while_a_run_is_in_flight(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """A retry is a run and spends like one, so it is refused while one is going too -- the
        guard `start` has, which `retry` lacked, letting a second paid pass overlap (BE-12)."""
        in_flight = await self.a_run_left_in_flight(database_url)

        refused = await api.post(f"/v1/data-acquisition-runs/{in_flight}/retry")

        assert refused.status_code == 409
        assert refused.json()["code"] == "run_already_in_flight"
        assert str(in_flight) in refused.json()["message"]

    async def test_nothing_is_fetched_by_the_refused_request(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """A refusal that had already written values would be a second run in all but name."""
        await self.a_run_left_in_flight(database_url)

        await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert (await api.get("/v1/values")).json()["total"] == 0

    async def test_a_run_starts_normally_when_nothing_is_in_flight(
        self, api: httpx.AsyncClient
    ) -> None:
        """The control. One at a time is a limit of one, not a limit of none."""
        started = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert started.status_code == 202

    async def test_a_finished_run_does_not_block_the_next_one(self, api: httpx.AsyncClient) -> None:
        """The other control: a run that has ended is not in flight, whatever its outcome."""
        first = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})
        assert first.status_code == 202

        second = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert second.status_code == 202


class TestTheResponseComesBeforeTheWork:
    """**202 means accepted, and now it means it** (P35).

    The contract has always said "started, poll for progress", and `RunProgress` and `getRun`
    exist precisely so a client can. The endpoint awaited the whole run inline, so a 160-item
    LLM run held the connection for minutes: a client timeout was indistinguishable from a
    failure, and retrying started a second concurrent run.

    The fetching is a background task now, so the response is built and sent first. That is
    what these assertions turn on -- the body reports a run still `running`, and polling the
    same id afterwards shows it finished.
    """

    async def test_the_response_reports_a_run_that_is_still_going(
        self, api: httpx.AsyncClient
    ) -> None:
        started = await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})

        assert started.status_code == 202
        # Built before a single figure was fetched. If this said `completed`, the work had
        # already happened and the 202 was a description of the past.
        assert started.json()["run_status"] == "running"
        assert started.json()["finished_at"] is None

    async def test_the_same_run_is_finished_when_it_is_polled(self, api: httpx.AsyncClient) -> None:
        """The other half: the client's id is good, and the record fills in behind it."""
        started = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

        detail = (await api.get(f"/v1/data-acquisition-runs/{started['id']}")).json()

        assert detail["id"] == started["id"]
        assert detail["run_status"] == "completed"
        assert detail["progress"]["items_total"] > 0

    async def test_a_refusal_still_comes_back_as_a_refusal(self, database_url: str) -> None:
        """**Every refusal is made before the response**, which is the whole reason `open_run`
        is a separate half. A spend cap checked in the background would be checked after the
        client had been told the run started."""
        async with an_api(database_url, (a_stub_source(charges=True),)) as api:
            refused = await api.post(
                "/v1/data-acquisition-runs",
                json={"level": COUNTRY, "attributes": [OVERBURDEN]},
            )

        assert refused.status_code == 409
        assert refused.json()["code"] == "spend_cap_not_set"


class TestStoppingARun:
    """`reqs.md` 6.4. A person can stop a run, and nothing it completed is lost.

    **The stop arrives from inside the run**, because there is no moment outside it to send one
    from: FastAPI's background task runs before the 202 reaches the caller under ASGI transport,
    so a test that tried to intervene between them would deadlock on its own stub. Asking the
    store directly is the same event the endpoint produces -- a row with a time on it -- and it
    makes the test about what the loop does with it rather than about scheduling.
    """

    async def test_it_halts_before_the_next_source_and_keeps_what_was_written(
        self, database_url: str
    ) -> None:
        asked_after = []

        async with AsyncConnectionPool(database_url, min_size=1, max_size=2) as pool:
            store = PostgresRunStore(pool)

            async def stop_this_run() -> None:
                in_flight = await store.run_in_flight()
                assert in_flight is not None, "the run must be open before its sources are asked"
                await store.request_stop(in_flight)

            async def note() -> None:
                asked_after.append("asked")

            first = a_stub_source(silent_about=(), before_answering=stop_this_run)
            second = a_stub_source(data_source="oecd", silent_about=(), before_answering=note)

            async with an_api(database_url, (first, second)) as api:
                run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
                detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["run_status"] == "halted_by_user"
        assert detail["stop_requested_at"] is not None
        # The source that had already answered kept its figures: a stop is a stop, not a
        # rollback -- the same guarantee the spend cap gives.
        assert detail["progress"]["items_completed"] > 0
        # And the source after it was never asked, which is what stopping means.
        assert asked_after == []

    async def test_a_run_nobody_stopped_finishes_and_is_unmarked(self, database_url: str) -> None:
        """The other half of the pair: the loop's new check must not end a run by itself."""
        async with an_api(database_url, (a_stub_source(),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{run['id']}")).json()

        assert detail["run_status"] == "completed"
        assert detail["stop_requested_at"] is None

    async def test_stopping_a_run_that_already_finished_is_not_an_error(
        self, database_url: str
    ) -> None:
        """The outcome the caller wanted is already true. Raising here would turn a harmless
        double-click into something a screen has to explain."""
        async with an_api(database_url, (a_stub_source(),)) as api:
            run = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            stopped = await api.post(f"/v1/data-acquisition-runs/{run['id']}/stop")

        assert stopped.status_code == 202
        # **And it leaves no trace.** A run that ended on its own must never read as one
        # somebody intervened in, which is the whole reason the fifth status exists.
        assert stopped.json()["run_status"] == "completed"
        assert stopped.json()["stop_requested_at"] is None

    async def test_stopping_a_run_that_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient
    ) -> None:
        assert (await api.post("/v1/data-acquisition-runs/999999/stop")).status_code == 404
