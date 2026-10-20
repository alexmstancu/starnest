"""Keeping a ranking, and reading back exactly what was kept (`reqs.md` 3.4a, Q156).

The point of a saved evaluation is that it still means what it meant: the criteria set it names
stays editable, so the snapshot is the only record of what the weights, bands, anchors and scope
actually were. These tests save one, change the live set, and read the saved one back unchanged.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import (
    CriteriaSet,
    Criterion,
    Goal,
    NormalisationMethod,
    PillarWeight,
    RangeThreshold,
    ReducerMode,
)
from starnest.data import ConfidenceLevel, Ratio, ReferencePeriod, Value, ValueType
from starnest.evaluation import (
    AttributeScore,
    CandidateResult,
    MatchStatus,
    NonMatch,
    RuleWarning,
    UnknownEvaluationError,
)
from starnest.storage import PostgresCriteriaStore, PostgresEvaluationStore, PostgresValueStore
from starnest.storage.connections import acquire
from starnest.storage.evaluation_store import TEST_EVALUATION_MARKER

pytestmark = pytest.mark.storage

SHIPPED = "local_employment"
COUNTRY = "country"
PORTUGAL = "country.portugal"
GREECE = "country.greece"
TAX = "country.total_tax_rate_effective"
SATISFACTION = "country.life_satisfaction"
CLIMATE_ZONE = "country.climate_zone"
COMPUTED_AT = datetime(2026, 9, 12, 9, 0, tzinfo=UTC)


def a_result(candidate: str, score: int | None, rank: int | None, **overrides: object):
    fields: dict[str, object] = {
        "candidate": candidate,
        "score": score,
        "coverage": Decimal("57.5"),
        "match_status": MatchStatus.MATCHING
        if score is not None
        else MatchStatus.INSUFFICIENT_DATA,
        "rank": rank,
        "attribute_scores": (
            AttributeScore(
                attribute=TAX,
                pillar="economics",
                normalised_score=score,
                effective_weight=Decimal("4.2"),
                contribution=Decimal("2.1"),
            ),
        ),
    }
    return CandidateResult(**(fields | overrides))  # type: ignore[arg-type]


@pytest.fixture
async def kept(pool: AsyncConnectionPool):
    """One saved evaluation of the shipped set, with two candidates."""
    criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
    store = PostgresEvaluationStore(pool)
    saved = await store.save(
        criteria=criteria,
        level=COUNTRY,
        results=[a_result(PORTUGAL, 71, 1), a_result(GREECE, None, None)],
        score_scale_max=100,
        computed_at=COMPUTED_AT,
        note="before the anchors changed",
    )
    return store, saved


class TestWhatIsKept:
    async def test_the_header_carries_the_scale_it_was_computed_on(self, kept) -> None:
        """A score of 71 means nothing without the top of its scale, and the setting may since
        have changed (`reqs.md` Q193)."""
        store, saved = kept

        read = await store.read_evaluation(saved.id)

        assert (read.criteria_set, read.level, read.score_scale_max) == (SHIPPED, COUNTRY, 100)
        assert read.computed_at == COMPUTED_AT
        assert read.note == "before the anchors changed"

    async def test_the_ranking_comes_back_ranked_and_keeps_the_unscoreable(self, kept) -> None:
        """A candidate that could not be scored is never filtered out (`reqs.md` 5.4)."""
        store, saved = kept

        results = await store.read_results(saved.id)

        assert [str(r.candidate) for r in results] == [PORTUGAL, GREECE]
        assert (results[0].score, results[0].rank) == (71, 1)
        assert results[1].score is None
        assert results[1].match_status is MatchStatus.INSUFFICIENT_DATA

    async def test_the_criteria_are_frozen_with_their_weights_and_anchors(self, kept) -> None:
        store, saved = kept

        frozen = await store.read_criteria(saved.id)

        tax = next(c for c in frozen.criteria if str(c.attribute) == TAX)
        assert tax.goal is Goal.MINIMISE
        assert tax.normalisation_method is NormalisationMethod.FIXED
        assert [(a.input_value, a.score) for a in tax.scale_anchors] == [
            (Decimal(35), 100),
            (Decimal(55), 0),
        ]
        assert sum(w.weight for w in frozen.pillar_weights) == Decimal(100)

    async def test_a_target_range_survives_the_snapshot(self, kept) -> None:
        """Four numbers, or the scale cannot be reproduced (`reqs.md` 5.1)."""
        store, saved = kept

        frozen = await store.read_criteria(saved.id)

        temperature = next(
            c for c in frozen.criteria if str(c.attribute) == "country.avg_annual_temperature"
        )
        assert temperature.goal is Goal.TARGET_RANGE
        assert temperature.target_range is not None
        assert (temperature.target_range.minimum, temperature.target_range.zero_above) == (
            Decimal(18),
            Decimal(38),
        )

    async def test_the_drill_down_explains_one_candidates_total(self, kept) -> None:
        store, saved = kept

        portugal = await store.read_candidate(saved.id, PORTUGAL)

        (row,) = portugal.attribute_scores
        assert (str(row.attribute), row.normalised_score) == (TAX, 71)
        assert row.effective_weight == Decimal("4.2")
        assert row.contribution == Decimal("2.1")

    async def test_editing_the_live_set_afterwards_does_not_move_the_snapshot(
        self, kept, pool: AsyncConnectionPool
    ) -> None:
        """The whole reason the snapshot exists (`reqs.md` Q156)."""
        store, saved = kept
        criteria = PostgresCriteriaStore(pool)
        live = await criteria.read_criteria_set(SHIPPED, level=COUNTRY)
        scratch = live.duplicated_as("evaluation_scratch", "Scratch")
        await criteria.create_criteria_set(scratch)

        try:
            frozen = await store.read_criteria(saved.id)
            assert len(frozen.criteria) == len(live.criteria)
        finally:
            await criteria.delete_criteria_set("evaluation_scratch")


def _an_interpreted_set(identifier: str) -> CriteriaSet:
    """A one-criterion set whose criterion carries every part of the rule the snapshot must
    freeze: a pinned weight, a reducer, and a typed matching threshold."""
    return CriteriaSet(
        id=identifier,
        name=identifier,
        criteria=(
            Criterion(
                criteria_set=identifier,
                attribute=SATISFACTION,
                pillar="culture",
                value_type=ValueType.QUANTITY,
                weight=Decimal(100),
                weight_locked=True,
                goal=Goal.MAXIMISE,
                normalisation_method=NormalisationMethod.PERCENTILE,
                reducer_mode=ReducerMode.AGGREGATE,
                matching_threshold=RangeThreshold(min_value=Decimal(5), max_value=Decimal(9)),
            ),
        ),
        pillar_weights=(PillarWeight(pillar="culture", level=COUNTRY, weight=Decimal(100)),),
    )


class TestTheWholeInterpretationIsFrozen:
    """ST-07, ST-08. A saved criterion keeps every part of the rule it was scored under -- the
    lock, the reducer, the typed threshold, and the value type -- which the read used to drop
    (the mapper ignored lock/reducer/threshold) or read live (the type was joined from the
    attribute, which `0478`/`0492` retype in place)."""

    @pytest.fixture
    async def frozen_criterion(self, pool: AsyncConnectionPool):
        criteria = PostgresCriteriaStore(pool)
        store = PostgresEvaluationStore(pool)
        scratch = _an_interpreted_set("evaluation_interpretation_scratch")
        await criteria.create_criteria_set(scratch)
        saved = await store.save(
            criteria=scratch,
            level=COUNTRY,
            results=[
                CandidateResult(
                    candidate=PORTUGAL,
                    score=70,
                    coverage=Decimal(100),
                    match_status=MatchStatus.MATCHING,
                    rank=1,
                    attribute_scores=(
                        AttributeScore(
                            attribute=SATISFACTION,
                            pillar="culture",
                            normalised_score=70,
                            effective_weight=Decimal(100),
                            contribution=Decimal(70),
                        ),
                    ),
                )
            ],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
            note=f"{TEST_EVALUATION_MARKER}ST-07/08 interpretation freeze",
        )
        frozen = await store.read_criteria(saved.id)
        try:
            yield next(c for c in frozen.criteria if str(c.attribute) == SATISFACTION)
        finally:
            await store.sweep_test_evaluations()
            await criteria.delete_criteria_set("evaluation_interpretation_scratch")

    async def test_the_lock_the_reducer_and_the_type_are_kept(self, frozen_criterion) -> None:
        assert frozen_criterion.weight_locked is True
        assert frozen_criterion.reducer_mode is ReducerMode.AGGREGATE
        assert frozen_criterion.value_type is ValueType.QUANTITY

    async def test_the_typed_matching_threshold_is_kept(self, frozen_criterion) -> None:
        threshold = frozen_criterion.matching_threshold
        assert isinstance(threshold, RangeThreshold)
        assert (threshold.min_value, threshold.max_value) == (Decimal(5), Decimal(9))

    async def test_the_type_is_read_from_the_snapshot_not_the_live_attribute(
        self, pool: AsyncConnectionPool
    ) -> None:
        """ST-08 proper: when the snapshot and the live attribute disagree -- which an in-place
        retype (`0478`, `0492`) produces -- the read returns the type the criterion was scored
        under, not today's. The live `life_satisfaction` stays Quantity while the snapshot is
        forced to Count (legal with the criterion's percentile method, so the rebuild still
        validates); the point is which type comes back."""
        criteria = PostgresCriteriaStore(pool)
        store = PostgresEvaluationStore(pool)
        scratch = _an_interpreted_set("evaluation_retype_scratch")
        await criteria.create_criteria_set(scratch)
        saved = await store.save(
            criteria=scratch,
            level=COUNTRY,
            results=[a_result(PORTUGAL, 70, 1)],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
            note=f"{TEST_EVALUATION_MARKER}ST-08 retype divergence",
        )
        async with pool.connection() as connection:
            await connection.execute(
                "UPDATE evaluation_criterion SET value_type = 'Count' "
                "WHERE evaluation = %s AND attribute = %s",
                (saved.id, SATISFACTION),
            )

        try:
            frozen = await store.read_criteria(saved.id)
            criterion = next(c for c in frozen.criteria if str(c.attribute) == SATISFACTION)
            assert criterion.value_type is ValueType.COUNT
        finally:
            await store.sweep_test_evaluations()
            await criteria.delete_criteria_set("evaluation_retype_scratch")


class TestWhatIsRefused:
    async def test_reading_an_evaluation_that_does_not_exist(
        self, pool: AsyncConnectionPool
    ) -> None:
        with pytest.raises(UnknownEvaluationError, match="999999"):
            await PostgresEvaluationStore(pool).read_evaluation(999999)

    async def test_a_candidate_the_evaluation_never_scored(self, kept) -> None:
        store, saved = kept

        with pytest.raises(UnknownEvaluationError, match="no result"):
            await store.read_candidate(saved.id, "country.iceland")


class TestTheRulesTravelWithTheResult:
    """A saved evaluation reads the same later, which includes why a candidate did not match
    and what it was flagged for (`reqs.md` 5.4, 3.7a)."""

    async def test_a_warning_and_a_non_match_reason_come_back(
        self, pool: AsyncConnectionPool
    ) -> None:
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        flagged = a_result(
            PORTUGAL,
            71,
            None,
            match_status=MatchStatus.NOT_MATCHING,
            warnings=(RuleWarning(compound_rule="cheap_but_taxed", detail="cheap and taxed"),),
            non_match_reasons=(
                NonMatch(match_rule="uk_skilled_worker", reason_detail="no sponsor"),
            ),
        )

        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[flagged],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (read,) = await store.read_results(saved.id)
        assert read.match_status is MatchStatus.NOT_MATCHING
        assert read.score == 71, "a candidate that does not match keeps its score"
        assert [str(w.compound_rule) for w in read.warnings] == ["cheap_but_taxed"]
        assert [str(r.match_rule) for r in read.non_match_reasons] == ["uk_skilled_worker"]
        assert read.non_match_reasons[0].reason_detail == "no sponsor"
        assert read.non_match_reasons[0].compound_rule is None

    async def test_the_saved_drill_down_carries_them_too(self, pool: AsyncConnectionPool) -> None:
        """The drill-down is the screen whose whole job is to explain the verdict, so it must
        carry the reasons -- not only the list beside it. `select_candidate_result` once omitted
        the two aggregations `select_evaluation_results` has, so `read_candidate` returned empty
        tuples and the saved drill-down showed `non_match_reasons: []` for a candidate the list
        explained (fixed 2026-10-12). `CandidateScoreDetailBody` requires the two drill-down
        paths -- live and saved -- to return the same shape, and the list already carried them."""
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        flagged = a_result(
            PORTUGAL,
            71,
            None,
            match_status=MatchStatus.NOT_MATCHING,
            warnings=(RuleWarning(compound_rule="cheap_but_taxed", detail="cheap and taxed"),),
            non_match_reasons=(
                NonMatch(match_rule="uk_skilled_worker", reason_detail="no sponsor"),
            ),
        )

        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[flagged],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        read = await store.read_candidate(saved.id, PORTUGAL)
        assert read.match_status is MatchStatus.NOT_MATCHING
        assert [str(w.compound_rule) for w in read.warnings] == ["cheap_but_taxed"]
        assert [str(r.match_rule) for r in read.non_match_reasons] == ["uk_skilled_worker"]
        assert read.non_match_reasons[0].reason_detail == "no sponsor"

    async def test_a_warning_keeps_the_value_rows_behind_it(
        self, pool: AsyncConnectionPool
    ) -> None:
        """ST-07 remainder: a saved warning records the ids of the figures it read, so its
        source/date chain can be reopened later. The value must exist for the frozen input to
        reference, so one is stored first and its id is what the warning carries."""
        (figure,) = await PostgresValueStore(pool).append(
            [
                Value(
                    candidate=PORTUGAL,
                    attribute="country.housing_cost_overburden_rate",
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
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        flagged = a_result(
            PORTUGAL,
            71,
            1,
            warnings=(
                RuleWarning(
                    compound_rule="cheap_but_taxed",
                    detail="cheap and taxed",
                    input_values=(figure.id,),
                ),
            ),
        )

        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[flagged],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (read,) = await store.read_results(saved.id)
        (warning,) = read.warnings
        assert warning.input_values == (figure.id,)
        drilled = await store.read_candidate(saved.id, PORTUGAL)
        assert drilled.warnings[0].input_values == (figure.id,)

    async def test_a_reason_naming_an_excluded_criterion_is_kept(
        self, pool: AsyncConnectionPool
    ) -> None:
        """An excluded criterion's threshold still rules out (BE-01), so a saved reason may name
        a criterion that scored nothing. The snapshot freezes every criterion at the level, scored
        or not, which is what lets `non_match_reason_names_a_frozen_criterion` accept it."""
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        excluded = next(c for c in criteria.criteria if str(c.attribute) == CLIMATE_ZONE)
        assert excluded.is_scored is False, "the shipped climate zone is the excluded criterion"
        reason = "country.climate_zone carries 'BWh', which you ruled out"
        ruled_out = a_result(
            PORTUGAL,
            71,
            None,
            match_status=MatchStatus.NOT_MATCHING,
            non_match_reasons=(NonMatch(criterion=CLIMATE_ZONE, reason_detail=reason),),
        )

        saved = await PostgresEvaluationStore(pool).save(
            criteria=criteria,
            level=COUNTRY,
            results=[ruled_out],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (read,) = await PostgresEvaluationStore(pool).read_results(saved.id)
        assert [str(r.criterion) for r in read.non_match_reasons] == [CLIMATE_ZONE]
        assert read.non_match_reasons[0].reason_detail == reason


class TestSweepingWhatATestSaved:
    """The one kind of saved evaluation nobody chose.

    Every other row here is a measurement a human decided to keep, which is why the contract
    has no delete for one. The browser suite saves one per run to prove saving works.
    """

    async def _save(self, pool: AsyncConnectionPool, note: str | None):
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        return store, await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[a_result(PORTUGAL, 71, 1)],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
            note=note,
        )

    async def test_it_discards_a_marked_evaluation(self, pool: AsyncConnectionPool) -> None:
        store, saved = await self._save(pool, f"{TEST_EVALUATION_MARKER}sanity suite 1790")

        discarded = await store.sweep_test_evaluations()

        assert discarded == 1
        with pytest.raises(UnknownEvaluationError):
            await store.read_evaluation(saved.id)

    async def test_it_leaves_an_evaluation_somebody_chose_to_keep(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The whole reason the marker is a prefix a human would not type."""
        store, saved = await self._save(pool, "the one I am going to act on")

        assert await store.sweep_test_evaluations() == 0
        assert (await store.read_evaluation(saved.id)).id == saved.id

    async def test_a_note_that_merely_mentions_the_marker_is_not_swept(
        self, pool: AsyncConnectionPool
    ) -> None:
        """A prefix, never a substring: a note *about* the suite is still somebody's note."""
        store, saved = await self._save(pool, f"why the {TEST_EVALUATION_MARKER}rows keep coming")

        assert await store.sweep_test_evaluations() == 0
        assert (await store.read_evaluation(saved.id)).id == saved.id

    async def test_an_evaluation_with_no_note_at_all_is_left(
        self, pool: AsyncConnectionPool
    ) -> None:
        store, saved = await self._save(pool, None)

        assert await store.sweep_test_evaluations() == 0
        assert (await store.read_evaluation(saved.id)).id == saved.id

    async def test_the_whole_snapshot_goes_with_it(self, pool: AsyncConnectionPool) -> None:
        """`0482` cascades. A frozen criterion left behind would pin the criteria set for ever,
        which is the fault that made the browser suite adopt a leftover set instead of making
        a fresh one."""
        store, saved = await self._save(pool, f"{TEST_EVALUATION_MARKER}sanity suite 1791")

        await store.sweep_test_evaluations()

        async with acquire(pool) as connection:
            for table in (
                "evaluation_criterion",
                "candidate_result",
                "evaluation_scale_anchor",
            ):
                left = await connection.execute(
                    f"SELECT count(*) FROM {table} WHERE evaluation = %s", (saved.id,)
                )
                assert (await left.fetchone())[0] == 0, f"{table} kept a row"

    async def test_sweeping_nothing_is_not_an_error(self, pool: AsyncConnectionPool) -> None:
        assert await PostgresEvaluationStore(pool).sweep_test_evaluations() == 0


class TestWhatAKeptRankingStillKnowsWhenItIsReopened:
    """The two fields a save used to lose (`0486`).

    `coverage_by_confidence` (`reqs.md` 5.7) and `insufficient_reason` (5.3) are computed when a
    ranking is produced and both reach the live screen. Neither had a column, so reopening a
    kept evaluation showed an empty split and no sentence -- while warnings and non-match
    reasons round-tripped perfectly, which is what made it look fine.
    """

    async def test_the_confidence_split_survives_the_round_trip(
        self, pool: AsyncConnectionPool
    ) -> None:
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        split = {
            ConfidenceLevel.ABSOLUTE: Decimal("0"),
            ConfidenceLevel.HIGH: Decimal("49"),
            ConfidenceLevel.MEDIUM: Decimal("0"),
            ConfidenceLevel.LOW: Decimal("51"),
        }
        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[a_result(PORTUGAL, 71, 1, coverage_by_confidence=split)],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (reopened,) = await store.read_results(saved.id)

        assert reopened.coverage_by_confidence == split

    async def test_a_zero_share_comes_back_as_zero_rather_than_absent(
        self, pool: AsyncConnectionPool
    ) -> None:
        """ "Of which 0% low" is a fact a screen shows, and a missing key is not the same
        claim as a zero."""
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[
                a_result(
                    PORTUGAL,
                    71,
                    1,
                    coverage_by_confidence={
                        grade: Decimal(100) if grade is ConfidenceLevel.HIGH else Decimal(0)
                        for grade in ConfidenceLevel
                    },
                )
            ],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (reopened,) = await store.read_results(saved.id)

        assert reopened.coverage_by_confidence[ConfidenceLevel.LOW] == 0

    async def test_the_reason_a_candidate_could_not_be_scored_survives(
        self, pool: AsyncConnectionPool
    ) -> None:
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[
                a_result(
                    GREECE,
                    None,
                    None,
                    insufficient_reason="no figure was found for any scored criterion",
                )
            ],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (reopened,) = await store.read_results(saved.id)

        assert reopened.insufficient_reason == ("no figure was found for any scored criterion")

    async def test_a_candidate_that_scored_carries_no_reason(
        self, pool: AsyncConnectionPool
    ) -> None:
        """A row holding both a score and an explanation of why it has none is two answers to
        one question, and the schema refuses it."""
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)
        saved = await store.save(
            criteria=criteria,
            level=COUNTRY,
            results=[a_result(PORTUGAL, 71, 1)],
            score_scale_max=100,
            computed_at=COMPUTED_AT,
        )

        (reopened,) = await store.read_results(saved.id)

        assert reopened.insufficient_reason is None

    async def test_a_scored_candidate_with_a_reason_is_refused_by_the_schema(
        self, pool: AsyncConnectionPool
    ) -> None:
        criteria = await PostgresCriteriaStore(pool).read_criteria_set(SHIPPED, level=COUNTRY)
        store = PostgresEvaluationStore(pool)

        with pytest.raises(Exception, match="explains_only_what_it_could_not_score"):
            await store.save(
                criteria=criteria,
                level=COUNTRY,
                results=[a_result(PORTUGAL, 71, 1, insufficient_reason="but it did score")],
                score_scale_max=100,
                computed_at=COMPUTED_AT,
            )
