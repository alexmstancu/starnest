"""Keeping a ranking, and reading back exactly what was kept (`reqs.md` 3.4a, Q156).

The point of a saved evaluation is that it still means what it meant: the criteria set it names
stays editable, so the snapshot is the only record of what the weights, bands, anchors and scope
actually were. These tests save one, change the live set, and read the saved one back unchanged.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import Goal, NormalisationMethod
from starnest.evaluation import (
    AttributeScore,
    CandidateResult,
    MatchStatus,
    NonMatch,
    RuleWarning,
    UnknownEvaluationError,
)
from starnest.storage import PostgresCriteriaStore, PostgresEvaluationStore

pytestmark = pytest.mark.storage

SHIPPED = "local_employment"
COUNTRY = "country"
PORTUGAL = "country.portugal"
GREECE = "country.greece"
TAX = "country.total_tax_rate_effective"
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
