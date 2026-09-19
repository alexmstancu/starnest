"""GATE D — the failure modes, which are only testable once everything else exists.

`devplan.md`. Four things the application claims about its worst days, and each is asserted here
rather than assumed:

1. **A process killed mid-run** leaves the run recoverable and the figures it wrote intact.
2. **Crossing the spend cap** halts the run and loses nothing.
3. **A stale schema** stops the application at boot, naming the gap.
4. **A dump restores**, and the restored database still holds what cannot be re-fetched.

**The first is proved by the mechanism rather than by a signal.** What a kill actually does is
leave a run `running` with whatever it had committed already committed -- so the test does both
halves: an adapter that raises after storing figures (which is per-item commits doing their job,
`arch.md` 7.1), and the startup sweep that finds a run nobody finished. Sending SIGKILL to a
subprocess would test the operating system.
"""

import os
import subprocess
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate
from starnest.data import Attribute
from starnest.data_acquisition import Acquired, RunStatus, SourceAdapter
from starnest.main import start_up
from starnest.storage import (
    PostgresCatalogStore,
    PostgresRunStore,
    SchemaBehindError,
)

from .conftest import a_stub_source, an_api

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"


class ADyingSource(SourceAdapter):
    """Answers one attribute and then dies, which is the shape of a process killed mid-run."""

    def __init__(self) -> None:
        self._asked = 0

    @property
    def data_source(self):  # type: ignore[no-untyped-def]
        from starnest.data import DataSourceId

        return DataSourceId("eurostat")

    @property
    def attributes(self) -> tuple:
        return (OVERBURDEN, "country.overcrowding_rate")

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        self._asked += 1
        if self._asked > 1:
            raise RuntimeError("the process died here")
        return await a_stub_source(answers=(str(attribute.id),), silent_about=()).fetch(
            attribute, candidates
        )


class TestAProcessThatDiedMidRun:
    async def test_the_figures_it_had_already_written_survive(self, database_url: str) -> None:
        """**Per-item commits are what makes this true** (`arch.md` 7.1), and it is worth
        proving rather than assuming: one transaction around a whole run would lose every figure
        the run had fetched before it died."""
        async with an_api(database_url, (ADyingSource(),)) as api:
            with pytest.raises(RuntimeError, match="the process died"):
                await api.post(
                    "/v1/data-acquisition-runs",
                    json={
                        "level": COUNTRY,
                        "attributes": [OVERBURDEN, "country.overcrowding_rate"],
                    },
                )

            stored = (await api.get("/v1/values?candidate=country.portugal&limit=100")).json()

        assert [value["attribute"] for value in stored["items"]] == [OVERBURDEN]

    async def test_the_run_is_recorded_failed_rather_than_left_running(
        self, database_url: str
    ) -> None:
        """The run stays visible as one that could not proceed. A run that vanished would leave
        the figures above with nothing to explain them."""
        async with an_api(database_url, (ADyingSource(),)) as api:
            with pytest.raises(RuntimeError):
                await api.post(
                    "/v1/data-acquisition-runs",
                    json={
                        "level": COUNTRY,
                        "attributes": [OVERBURDEN, "country.overcrowding_rate"],
                    },
                )

            runs = (await api.get("/v1/data-acquisition-runs?limit=1")).json()["items"]

        assert runs[0]["run_status"] == "failed"

    async def test_a_run_the_kill_left_running_is_swept_at_the_next_boot(
        self, database_url: str
    ) -> None:
        """The other half: a killed process never reaches the `except`, so the run stays
        `running` until something notices. That something is the startup sequence."""
        from starnest.data_acquisition import RunScope

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            runs = PostgresRunStore(pool)
            abandoned = await runs.start_run(
                RunScope(level=COUNTRY, candidates=("country.portugal",), attributes=(OVERBURDEN,)),
                triggered_by="a process that was killed",
            )

            booted = await start_up(
                database_url=database_url,
                pool=pool,
                catalog=PostgresCatalogStore(pool),
                runs=runs,
                adapters=(a_stub_source(),),
            )

            swept = await runs.read_run(abandoned)

        assert abandoned in booted.runs_swept
        assert swept.status is RunStatus.FAILED

    async def test_what_it_failed_on_can_be_retried(self, database_url: str) -> None:
        """The whole point of recording it: a retry over what did not arrive."""
        async with an_api(database_url, (a_stub_source(),)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json={"level": COUNTRY})).json()

            retried = await api.post(f"/v1/data-acquisition-runs/{first['id']}/retry")

        assert retried.status_code == 202
        assert retried.json()["id"] != first["id"]


class TestCrossingTheSpendCap:
    async def test_the_run_halts_and_keeps_everything_it_fetched(self, database_url: str) -> None:
        """`reqs.md` 6.3. In-flight work has already committed, the status says why it stopped,
        and a retry over the rest is the obvious next step."""
        free = a_stub_source(answers=(OVERBURDEN,), silent_about=())
        paid = _a_source_that_charges(Decimal(5))

        async with an_api(database_url, (free, paid)) as api:
            await api.put(
                "/v1/settings",
                json={"run_spend_cap_eur": 1, "score_scale_max": 100, "comparator_limit": 5},
            )

            started = (
                await api.post(
                    "/v1/data-acquisition-runs",
                    json={"level": COUNTRY, "attributes": [OVERBURDEN]},
                )
            ).json()
            detail = (await api.get(f"/v1/data-acquisition-runs/{started['id']}")).json()
            values = (await api.get("/v1/values?candidate=country.portugal&limit=100")).json()

        assert detail["run_status"] == "halted_on_spend_cap"
        # The free source ran first and its figures are stored: a halt is a stop, not a rollback.
        assert values["total"] >= 1

    async def test_what_it_spent_is_recorded_on_the_run(self, database_url: str) -> None:
        """So "why did this stop?" is answerable from the run record rather than from a log.

        **Read by polling, because the start response now describes a run that has just
        opened** (P35). It reports what was accepted -- an id, and `running` -- and the spend
        is something the run learns afterwards. Reading it from the response worked only while
        the endpoint blocked until the run had finished, which is the thing that cost 2.70 EUR.
        """
        async with an_api(database_url, (_a_source_that_charges(Decimal("2.50")),)) as api:
            await api.put(
                "/v1/settings",
                json={"run_spend_cap_eur": 1, "score_scale_max": 100, "comparator_limit": 5},
            )

            started = (
                await api.post(
                    "/v1/data-acquisition-runs",
                    json={"level": COUNTRY, "attributes": [OVERBURDEN]},
                )
            ).json()
            assert started["cost_eur"] == 0, "nothing has been spent at the moment it opens"

            recorded = (await api.get(f"/v1/data-acquisition-runs/{started['id']}")).json()

        assert recorded["cost_eur"] == pytest.approx(2.5)


def _a_source_that_charges(cost: Decimal) -> SourceAdapter:
    """A source that answers nothing and bills for it, which is all the cap needs to bite."""

    class Charging(SourceAdapter):
        @property
        def data_source(self):  # type: ignore[no-untyped-def]
            from starnest.data import DataSourceId

            return DataSourceId("llm")

        @property
        def costs_money(self) -> bool:
            return True

        @property
        def attributes(self) -> tuple:
            return (OVERBURDEN,)

        async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
            return Acquired(cost_eur=cost, calls=1)

    return Charging()


class TestAStaleSchema:
    def test_the_application_refuses_to_start_and_names_the_gap(
        self, database_url: str, tmp_path: Path
    ) -> None:
        """Asserted here as part of the gate as well as in `tests/storage`, because "it refuses"
        is one of the four things Gate D is about."""
        from starnest.storage import refuse_if_behind

        (tmp_path / "0999-the-migration-nobody-applied.sql").write_text(
            "-- depends:\n\nSELECT 1;\n"
        )

        with pytest.raises(SchemaBehindError) as refusal:
            refuse_if_behind(database_url, migrations=tmp_path)

        assert "0999-the-migration-nobody-applied" in str(refusal.value)
        assert "make migrate" in str(refusal.value)


class TestRestoringFromADump:
    """**An untested backup is not a backup** (`arch.md` 9.5).

    What is being protected is specific: structured values could be re-fetched slowly, LLM
    values would cost money again, and **manually entered values cannot be re-fetched at any
    price**. So the figure this test writes before the dump is a manual one, and finding it in
    the restored database is the assertion.

    `pg_dump` lives in the database container rather than on this machine, so the dump and the
    restore run there -- which is also how `make backup` does it.
    """

    CONTAINER = "starnest-database-1"

    def _in_the_container(self, *command: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", "exec", self.CONTAINER, *command],
            capture_output=True,
            text=True,
            check=False,
        )

    @pytest.fixture(autouse=True)
    def _needs_the_container(self) -> None:
        if os.environ.get("SKIP_DOCKER_TESTS"):
            pytest.skip("SKIP_DOCKER_TESTS is set")
        if self._in_the_container("which", "pg_dump").returncode != 0:
            pytest.skip(f"{self.CONTAINER} is not running, so there is nothing to dump")

    async def test_a_manual_value_survives_a_dump_and_a_restore(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        typed = await api.post(
            "/v1/values/manual",
            json={
                "candidate": "country.portugal",
                "attribute": "country.remote_work_tax_treaty",
                "payload": {"labels": ["country.romania"]},
                "reference_period": {"start": "2026-01-01", "end": "2026-12-31"},
                "retrieval_date": datetime.now(tz=UTC).isoformat(),
                "quote": "typed by hand, and unre-fetchable at any price",
            },
        )
        assert typed.status_code == 201, typed.text

        source = database_url.rsplit("/", 1)[-1]
        restored = f"{source}_restored"
        dump = f"/tmp/{source}.dump"

        assert (
            self._in_the_container(
                "pg_dump", "-U", "starnest", "--format=custom", "--file", dump, source
            ).returncode
            == 0
        )
        self._in_the_container("dropdb", "-U", "starnest", "--if-exists", "--force", restored)
        assert self._in_the_container("createdb", "-U", "starnest", restored).returncode == 0
        assert (
            self._in_the_container(
                "pg_restore", "-U", "starnest", "--dbname", restored, dump
            ).returncode
            == 0
        )

        try:
            found = self._in_the_container(
                "psql",
                "-U",
                "starnest",
                "-d",
                restored,
                "-t",
                "-c",
                "SELECT count(*) FROM value WHERE data_source = 'manual' "
                "AND attribute = 'country.remote_work_tax_treaty'",
            )
            catalogued = self._in_the_container(
                "psql",
                "-U",
                "starnest",
                "-d",
                restored,
                "-t",
                "-c",
                "SELECT count(*) FROM attribute",
            )
        finally:
            self._in_the_container("dropdb", "-U", "starnest", "--force", restored)

        assert int(found.stdout.strip()) == 1, "the hand-typed value did not survive the restore"
        assert int(catalogued.stdout.strip()) > 40, "the catalog did not survive the restore"
