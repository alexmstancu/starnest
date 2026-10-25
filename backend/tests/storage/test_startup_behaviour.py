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
from starnest.evaluation import NonMatch, RuleWarning
from starnest.main import AdapterDeclarationError, start_up
from starnest.storage import (
    PostgresCatalogStore,
    PostgresCriteriaStore,
    PostgresEvaluationStore,
    PostgresMatchRuleResultStore,
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

    async def _save(
        self,
        pool: AsyncConnectionPool,
        note: str,
        warnings: tuple[RuleWarning, ...] = (),
        non_match_reasons: tuple[NonMatch, ...] = (),
    ) -> int:
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
                    warnings=warnings,
                    non_match_reasons=non_match_reasons,
                )
            ],
            score_scale_max=100,
            computed_at=datetime.now(tz=UTC),
            note=note,
        )
        return saved.id

    async def _a_real_value_id(self, pool: AsyncConnectionPool) -> int:
        """A value row to hang a warning's input on. The warning-input FK is to `value (id)`, so
        the id must be a real one -- stored here because the storage database is schema-only."""
        from datetime import UTC, datetime

        from starnest.data import ConfidenceLevel, Ratio, ReferencePeriod, Value, ValueType
        from starnest.storage import PostgresValueStore

        (figure,) = await PostgresValueStore(pool).append(
            [
                Value(
                    candidate="country.portugal",
                    attribute=OVERBURDEN,
                    value_type=ValueType.RATIO,
                    data_source="eurostat",
                    reference_period=ReferencePeriod(
                        start=datetime(2025, 1, 1).date(), end=datetime(2025, 12, 31).date()
                    ),
                    retrieval_date=datetime(2026, 9, 1, tzinfo=UTC),
                    confidence_level=ConfidenceLevel.HIGH,
                    payload=Ratio(value=Decimal("6.3"), basis="households"),
                )
            ]
        )
        return figure.id

    async def test_the_boot_discards_a_saved_warning_and_the_figures_behind_it(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        """A saved warning's frozen input rows (ST-07, `0504`) must die with the evaluation.

        The boot sweep deletes a test ranking's `candidate_warning` rows; a
        `candidate_warning_input` child with no `ON DELETE CASCADE` blocks that delete, so the
        sweep raises and the backend refuses to start. `_save`'s warning-less result could not
        reach this row, and `TRUNCATE CASCADE` in the other storage tests hides it -- which is
        why `make check` stayed green over a shipped boot regression (`0482` is the rule: an
        evaluation's children die with it in the schema, not by a hand-ordered delete).
        """
        a_value = await self._a_real_value_id(pool)
        await self._save(
            pool,
            f"{TEST_EVALUATION_MARKER}sanity suite with a warning",
            warnings=(
                RuleWarning(
                    compound_rule="cheap_but_taxed",
                    detail="a flag that rules nothing out",
                    input_values=(a_value,),
                ),
            ),
        )

        booted = await boot(pool, database_url)

        assert booted.test_evaluations_swept == 1

    async def test_the_boot_discards_the_rest_of_a_frozen_ranking(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        """ST-07 `0507`: the three tables that freeze the rest of a ranking -- the enforced and
        applied rule lists and a not_matching rule's input figures -- each hang off a row the
        sweep deletes, so each needs `ON DELETE CASCADE` (the one `0504` forgot). A row in every
        one of them, and the sweep must still succeed."""
        a_value = await self._a_real_value_id(pool)
        evaluation = await self._save(pool, f"{TEST_EVALUATION_MARKER}sanity suite frozen whole")

        async with pool.connection() as connection:
            (match_rule,) = await (
                await connection.execute("SELECT id FROM match_rule LIMIT 1")
            ).fetchone()
            (compound_rule,) = await (
                await connection.execute("SELECT id FROM compound_rule LIMIT 1")
            ).fetchone()
            (candidate_result,) = await (
                await connection.execute(
                    "SELECT id FROM candidate_result WHERE evaluation = %s", (evaluation,)
                )
            ).fetchone()
            await connection.execute(
                "INSERT INTO evaluation_match_rule (evaluation, match_rule) VALUES (%s, %s)",
                (evaluation, match_rule),
            )
            await connection.execute(
                "INSERT INTO evaluation_compound_rule (evaluation, compound_rule, outcome)"
                " VALUES (%s, %s, 'warning')",
                (evaluation, compound_rule),
            )
            await connection.execute(
                "INSERT INTO non_match_input (candidate_result, compound_rule, value_id, ordinal) "
                "VALUES (%s, %s, %s, 0)",
                (candidate_result, compound_rule, a_value),
            )

        booted = await boot(pool, database_url)

        assert booted.test_evaluations_swept == 1

    async def test_the_boot_discards_a_gate_refusal_and_keeps_the_answer_it_cited(
        self, pool: AsyncConnectionPool, database_url: str
    ) -> None:
        """PL-143: a saved gate refusal cites a gate-answer version by an outgoing key, so the
        sweep deletes the refusal and the version -- recorded history -- stays."""
        from datetime import UTC, datetime

        from starnest.data import MatchResult, MatchRuleResult

        gates = PostgresMatchRuleResultStore(pool)
        await gates.record(
            MatchRuleResult(
                match_rule="uk_skilled_worker",
                candidate="country.portugal",
                match_result=MatchResult.NOT_MATCHING,
                data_source="manual",
                retrieval_date=datetime.now(tz=UTC),
            )
        )
        (answer,) = await gates.read_results(candidate="country.portugal")
        try:
            await self._save(
                pool,
                f"{TEST_EVALUATION_MARKER}sanity suite with a gate refusal",
                non_match_reasons=(
                    NonMatch(match_rule=answer.match_rule, reason_detail="x", gate_answer=answer),
                ),
            )

            booted = await boot(pool, database_url)

            assert booted.test_evaluations_swept == 1
            async with pool.connection() as connection:
                kept = await (
                    await connection.execute(
                        "SELECT count(*) FROM match_rule_answer WHERE id = %s", (answer.id,)
                    )
                ).fetchone()
            assert kept == (1,)
        finally:
            async with pool.connection() as connection:
                await connection.execute("TRUNCATE match_rule_answer CASCADE")

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
