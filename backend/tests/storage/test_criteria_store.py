"""Criteria sets through the seam, against the seeded catalog and sets the tests build.

The read is one query returning four JSON aggregates, and the mapper turns them back into the
domain object -- so what is really under test is that a set survives the round trip through
PostgreSQL and `jsonb` unchanged. `CriteriaSet` refuses a set whose weights do not sum, which
means a mapper that dropped a criterion or misread a weight fails loudly here rather than
producing a plausible ranking later.

The `minimal` set (`0121`) is the one minE2E scores with, so it is read here as the shipped
catalog holds it rather than as a fixture invented to be convenient.
"""

from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import (
    CriteriaSet,
    Goal,
    NormalisationMethod,
    PillarWeight,
    UnknownCriteriaSetError,
)
from starnest.storage import PostgresCriteriaStore

pytestmark = pytest.mark.storage

MINIMAL = "minimal"
SHIPPED = "local_employment"

THE_ANCHORS_THE_HOUSEHOLD_CHOSE = {
    "country.total_tax_rate_effective": ((Decimal(35), 100), (Decimal(55), 0)),
    "country.housing_cost_overburden_rate": ((Decimal(5), 100), (Decimal(20), 0)),
    "country.tech_employment_share": ((Decimal(3), 0), (Decimal(7), 100)),
    "country.broadband_coverage": ((Decimal(80), 0), (Decimal(100), 100)),
    "country.life_satisfaction": ((Decimal(6), 0), (Decimal(8), 100)),
    "country.economic_outlook": ((Decimal(0), 0), (Decimal(3), 100)),
    "country.overcrowding_rate": ((Decimal(5), 100), (Decimal(30), 0)),
    "country.protected_land_share": ((Decimal(10), 0), (Decimal(40), 100)),
}
"""Every anchor the shipped set carries, each one decided against real figures (Q206, Q209).

**The roster is the point.** "No anchor ships" held until `0447`, and it was never the real
rule -- the rule is that no anchor ships that nobody chose. An anchor appearing here without a
decision is the failure this catches, so adding one means changing this line deliberately.
"""
COUNTRY = "country"


@pytest.fixture
def criteria(pool: AsyncConnectionPool) -> PostgresCriteriaStore:
    return PostgresCriteriaStore(pool)


class TestReadingASet:
    async def test_the_summaries_carry_every_set(self, criteria: PostgresCriteriaStore) -> None:
        """The switcher shows names, so it reads names -- not 41 criteria per set to fill a
        dropdown."""
        summaries = dict(await criteria.read_criteria_set_summaries())

        assert MINIMAL in summaries
        assert SHIPPED in summaries

    async def test_a_whole_set_round_trips_through_the_database(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """`CriteriaSet` validates the weight sums on the way out as much as on the way in, so
        a mapper that dropped a criterion could not produce this object at all."""
        minimal = await criteria.read_criteria_set(MINIMAL, level=COUNTRY)

        assert isinstance(minimal, CriteriaSet)
        # Not a list of names. `CriteriaSet` refuses to construct when a pillar's criteria do
        # not sum to 100, so a mapper that dropped one could not have produced this object --
        # which is a stronger statement than any roster, and one that survives the catalog
        # growing. Naming the members broke this twice during P4 for no defect at all.
        assert minimal.criteria
        assert all(c.pillar for c in minimal.criteria)
        assert len({c.attribute for c in minimal.criteria}) == len(minimal.criteria)

    async def test_a_criterion_keeps_its_interpretation(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """Goal, method and weight are what turn a figure into a score. Any of them read wrong
        produces a ranking that looks right."""
        minimal = await criteria.read_criteria_set(MINIMAL, level=COUNTRY)

        overburden = minimal.criterion_for("country.housing_cost_overburden_rate")
        assert overburden.goal is Goal.MINIMISE
        assert overburden.normalisation_method is NormalisationMethod.PERCENTILE
        assert overburden.weight == Decimal(50)

    async def test_weights_are_decimals_and_never_floats(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """`jsonb` gives back floats, and a weight that became 49.99999999 would fail the sum
        the domain checks (`arch.md` 9.6)."""
        minimal = await criteria.read_criteria_set(MINIMAL, level=COUNTRY)

        assert all(isinstance(c.weight, Decimal) for c in minimal.criteria)
        assert all(isinstance(w.weight, Decimal) for w in minimal.pillar_weights)

    async def test_the_pillar_weights_come_back_with_the_criteria(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        minimal = await criteria.read_criteria_set(MINIMAL, level=COUNTRY)

        weights = {str(w.pillar): w.weight for w in minimal.pillar_weights}

        assert sum(weights.values()) == Decimal(100)
        assert {str(c.pillar) for c in minimal.criteria} <= set(weights), (
            "a criterion in a pillar with no weight contributes nothing and cannot be scored"
        )

    async def test_the_shipped_set_reads_with_its_anchors_and_thresholds(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """41 criteria, four threshold shapes and the rules it enforces. The heavier read, and
        the one that would expose a mapper that only handles the simple case."""
        shipped = await criteria.read_criteria_set(SHIPPED, level=COUNTRY)

        assert len(shipped.criteria) == 41
        assert shipped.enforced_match_rules
        # Not an omission in the read: `reqs.md` 7.4 leaves every threshold TBD, and an anchor
        # ships only where the household chose it against real figures. A seeded one nobody
        # chose would be a plausible number with no author (`devplan.md` 0.3).
        assert all(c.matching_threshold is None for c in shipped.criteria)
        anchored = {
            str(c.attribute): tuple((a.input_value, a.score) for a in c.scale_anchors)
            for c in shipped.criteria
            if c.scale_anchors
        }
        assert anchored == THE_ANCHORS_THE_HOUSEHOLD_CHOSE, (
            "an anchor shipped that nobody chose, or a chosen one was lost on the way out"
        )

    async def test_reading_a_set_that_does_not_exist_says_so(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """A mistyped identifier is reported rather than returning an empty set, which would
        score every candidate as insufficient data for a reason nobody could find."""
        with pytest.raises(UnknownCriteriaSetError, match="no criteria set"):
            await criteria.read_criteria_set("nobody_made_this")


class TestWritingASet:
    async def test_a_set_can_be_created_and_read_back(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        built = _a_set("created_by_a_test", weight="100")

        await criteria.create_criteria_set(built)
        try:
            read_back = await criteria.read_criteria_set("created_by_a_test", level=COUNTRY)
            assert read_back.criterion_for("country.life_satisfaction").weight == Decimal(100)
        finally:
            await criteria.delete_criteria_set("created_by_a_test")

    async def test_replacing_a_set_overwrites_its_criteria(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """The path a weight change takes: read the set, ask the domain for the new one, write
        it back whole. Working out the difference here would put the rebalancing rules in two
        places."""
        await criteria.create_criteria_set(_a_set("replaced_by_a_test", weight="100"))
        try:
            changed = _a_set("replaced_by_a_test", weight="100", goal=Goal.MINIMISE)

            await criteria.replace_criteria_set(changed)

            read_back = await criteria.read_criteria_set("replaced_by_a_test", level=COUNTRY)
            assert read_back.criterion_for("country.life_satisfaction").goal is Goal.MINIMISE
            assert len(read_back.criteria) == 1
        finally:
            await criteria.delete_criteria_set("replaced_by_a_test")

    async def test_replacing_a_set_that_does_not_exist_is_refused(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """Creating instead would turn a mistyped identifier into a set nobody asked for --
        the kind of success that is worse than a failure."""
        with pytest.raises(UnknownCriteriaSetError, match="to replace"):
            await criteria.replace_criteria_set(_a_set("never_created", weight="100"))

    async def test_deleting_a_set_that_does_not_exist_is_refused(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """So a second delete is reported rather than silently succeeding."""
        with pytest.raises(UnknownCriteriaSetError, match="to delete"):
            await criteria.delete_criteria_set("never_created")

    async def test_a_deleted_set_is_gone_along_with_its_criteria(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        await criteria.create_criteria_set(_a_set("deleted_by_a_test", weight="100"))

        await criteria.delete_criteria_set("deleted_by_a_test")

        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set("deleted_by_a_test")


def _a_set(
    identifier: str,
    *,
    weight: str,
    goal: Goal = Goal.MAXIMISE,
    threshold: object = None,
    anchors: tuple = (),
) -> CriteriaSet:
    """One criterion in one pillar, which is the smallest set whose weights sum."""
    from starnest.criteria import Criterion
    from starnest.data import ValueType

    return CriteriaSet(
        id=identifier,
        name=identifier,
        criteria=(
            Criterion(
                criteria_set=identifier,
                attribute="country.life_satisfaction",
                pillar="culture",
                value_type=ValueType.QUANTITY,
                weight=Decimal(weight),
                goal=goal,
                normalisation_method=NormalisationMethod.PERCENTILE,
                matching_threshold=threshold,
                scale_anchors=anchors,
            ),
        ),
        pillar_weights=(PillarWeight(pillar="culture", level=COUNTRY, weight=Decimal(100)),),
    )


class TestTheChildrenOfACriterion:
    """Anchors and thresholds, which nothing in the shipped catalog exercises.

    Zero of each is seeded, on purpose -- so these are the only tests that touch those mappers,
    and without them a set could round-trip through the database and come back missing the part
    that decides what its numbers mean. That is the band-label defect H5 exactly, and the first
    draft of this module had it: thresholds were read and never written.
    """

    async def test_a_matching_threshold_survives_being_written_and_read(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        from starnest.criteria import RangeThreshold

        built = _a_set(
            "threshold_round_trip",
            weight="100",
            threshold=RangeThreshold(min_value=Decimal(5), max_value=Decimal(9)),
        )

        await criteria.create_criteria_set(built)
        try:
            read_back = await criteria.read_criteria_set("threshold_round_trip", level=COUNTRY)

            threshold = read_back.criterion_for("country.life_satisfaction").matching_threshold
            assert isinstance(threshold, RangeThreshold)
            assert (threshold.min_value, threshold.max_value) == (Decimal(5), Decimal(9))
        finally:
            await criteria.delete_criteria_set("threshold_round_trip")

    async def test_scale_anchors_survive_with_their_labels(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """The label is nullable, which is what made H5 silent: a copy that dropped it scored
        identically and read wrong."""
        from starnest.criteria import ScaleAnchor

        built = _a_set(
            "anchor_round_trip",
            weight="100",
            anchors=(
                ScaleAnchor(input_value=Decimal(4), score=0, label="poor"),
                ScaleAnchor(input_value=Decimal(8), score=100, label="good"),
            ),
        )

        await criteria.create_criteria_set(built)
        try:
            read_back = await criteria.read_criteria_set("anchor_round_trip", level=COUNTRY)

            anchors = read_back.criterion_for("country.life_satisfaction").scale_anchors
            assert [(a.input_value, a.score, a.label) for a in anchors] == [
                (Decimal(4), 0, "poor"),
                (Decimal(8), 100, "good"),
            ]
        finally:
            await criteria.delete_criteria_set("anchor_round_trip")
