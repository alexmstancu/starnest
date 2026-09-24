"""The startup sequence against a real database (`arch.md` 9.2).

Here rather than in `tests/unit/` because two of the three steps are questions about a database:
whether it is behind the code, and what it has left running. The third -- whether the adapters
agree with the catalog -- is a pure function tested in `tests/unit/test_startup.py`; what this
adds is that the sequence *runs it*, and refuses when it complains.

**A function, not a server.** `start_up` is called directly, because what is worth testing is
the order and the refusals rather than FastAPI's event plumbing.
"""

import re
from collections.abc import Sequence
from decimal import Decimal
from pathlib import Path

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate
from starnest.data import Attribute, DataSourceId
from starnest.data_acquisition import Acquired, RunScope, SourceAdapter
from starnest.main import AdapterDeclarationError, start_up
from starnest.storage import (
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresEvaluationStore,
    PostgresRunStore,
    SchemaBehindError,
)
from starnest.storage.evaluation_store import TEST_EVALUATION_MARKER

pytestmark = pytest.mark.storage

OVERBURDEN = "country.housing_cost_overburden_rate"


class StubSource(SourceAdapter):
    """A source that declares what the test tells it to and fetches nothing."""

    def __init__(self, source: str = "eurostat", declares: tuple[str, ...] = (OVERBURDEN,)):
        self._source = source
        self._declares = declares

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._source)

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        return Acquired()


async def boot(
    pool: AsyncConnectionPool,
    database_url: str,
    *,
    adapters: Sequence[SourceAdapter] = (),
    migrations: Path | None = None,
):
    return await start_up(
        database_url=database_url,
        pool=pool,
        catalog=PostgresCatalogStore(pool),
        runs=PostgresRunStore(pool),
        adapters=adapters or (StubSource(),),
        evaluations=PostgresEvaluationStore(pool),
        migrations=migrations,
    )


async def test_a_current_database_and_an_agreeing_registry_start(
    pool: AsyncConnectionPool, database_url: str
) -> None:
    booted = await boot(pool, database_url)

    assert booted.migrations_applied > 50
    assert booted.sources_registered == ("eurostat",)
    assert booted.runs_swept == ()


async def test_it_refuses_to_start_against_a_database_that_is_behind(
    pool: AsyncConnectionPool, database_url: str, tmp_path: Path
) -> None:
    """The check that earns its place: the alternative is a first write that fails hours later
    as a value nobody can explain."""
    (tmp_path / "0999-a-migration-nobody-applied.sql").write_text("-- depends:\n\nSELECT 1;\n")

    with pytest.raises(SchemaBehindError, match=re.escape("0999-a-migration-nobody-applied")):
        await boot(pool, database_url, migrations=tmp_path)


async def test_it_refuses_to_start_when_an_adapter_names_an_attribute_nobody_has(
    pool: AsyncConnectionPool, database_url: str
) -> None:
    """A run would otherwise fail halfway through, reporting something that reads like the
    source's fault."""
    with pytest.raises(AdapterDeclarationError, match=re.escape("country.rent_by_moonlight")):
        await boot(
            pool, database_url, adapters=(StubSource(declares=("country.rent_by_moonlight",)),)
        )

    # And it says what to do with it: the complaint names the source as well as the attribute.
    with pytest.raises(AdapterDeclarationError, match="eurostat"):
        await boot(pool, database_url, adapters=(StubSource(declares=("country.nor_this",)),))


async def test_it_sweeps_the_run_a_dead_process_left_behind(
    pool: AsyncConnectionPool, database_url: str
) -> None:
    """Nothing else starts a run (`reqs.md` 10), so a run still `running` at boot is one whose
    process died -- and the values it wrote keep its id (`arch.md` 7.1)."""
    abandoned = await PostgresRunStore(pool).start_run(
        RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,)),
        triggered_by="a process that died",
    )

    booted = await boot(pool, database_url)

    assert booted.runs_swept == (abandoned,)
    assert str((await PostgresRunStore(pool).read_run(abandoned)).status) == "failed"


async def test_the_boot_log_says_what_it_decided(
    pool: AsyncConnectionPool, database_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    """`arch.md` 9.4: the boot log is what answers "why did it refuse to start", so it has to
    say what it found even when it found nothing wrong."""
    with caplog.at_level("INFO", logger="starnest.boot"):
        await boot(pool, database_url)

    # `getMessage()` rather than `.message`: the second only exists once a formatter has
    # run, and applying the args by hand double-formats whatever is already interpolated.
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "schema is current" in logged
    assert "sources registered" in logged
    assert "no abandoned run" in logged


async def test_a_sweep_is_a_warning_rather_than_a_note(
    pool: AsyncConnectionPool, database_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    """A run somebody's process abandoned is worth noticing in a log somebody skims."""
    await PostgresRunStore(pool).start_run(
        RunScope(level="country", candidates=("country.portugal",), attributes=(OVERBURDEN,)),
        triggered_by="a process that died",
    )

    with caplog.at_level("INFO", logger="starnest.boot"):
        await boot(pool, database_url)

    assert [
        record.levelname for record in caplog.records if "left running" in record.getMessage()
    ] == ["WARNING"]


class TestSweepingWhatATestSaved:
    """`arch.md` 9.2, last step. The one saved evaluation nobody chose.

    The contract has no delete for a saved evaluation, on purpose: one is a measurement somebody
    decided to keep. The browser suite saves one per run to prove saving works and decided
    nothing, so the boot sequence discards the ones it marked.
    """

    async def _save(self, pool: AsyncConnectionPool, note: str) -> int:
        from datetime import UTC, datetime

        from starnest.evaluation import CandidateResult, MatchStatus

        criteria = await PostgresCriteriaStore(pool).read_criteria_set("minimal", level="country")
        saved = await PostgresEvaluationStore(pool).save(
            criteria=criteria,
            level="country",
            results=[
                CandidateResult(
                    candidate="country.portugal",
                    score=71,
                    rank=1,
                    coverage=Decimal("100"),
                    match_status=MatchStatus.MATCHING,
                )
            ],
            score_scale_max=100,
            computed_at=datetime.now(tz=UTC),
            note=note,
        )
        return saved.id

    async def test_the_boot_discards_what_the_browser_suite_saved(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        await self._save(pool, f"{TEST_EVALUATION_MARKER}sanity suite 1790")

        booted = await boot(pool, database_url)

        assert booted.test_evaluations_swept == 1

    async def test_it_leaves_an_evaluation_somebody_chose_to_keep(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        """The step must be safe to run on every boot of a real installation, which is the only
        reason it can be in the boot sequence at all."""
        kept = await self._save(pool, "the one I am going to act on")

        booted = await boot(pool, database_url)

        assert booted.test_evaluations_swept == 0
        assert (await PostgresEvaluationStore(pool).read_evaluation(kept)).id == kept

    async def test_a_boot_with_no_evaluation_store_sweeps_nothing(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        """`evaluations` is optional so the other startup tests need not build one. A boot that
        was not given a store reports nothing swept rather than failing."""
        booted = await start_up(
            database_url=database_url,
            pool=pool,
            catalog=PostgresCatalogStore(pool),
            runs=PostgresRunStore(pool),
            adapters=(StubSource(),),
        )

        assert booted.test_evaluations_swept == 0
