"""Criteria sets through the seam, against the seeded catalog and sets the tests build.

The read is one query returning four JSON aggregates, and the mapper turns them back into the
domain object -- so what is really under test is that a set survives the round trip through
PostgreSQL and `jsonb` unchanged. `CriteriaSet` refuses a set whose weights do not sum, which
means a mapper that dropped a criterion or misread a weight fails loudly here rather than
producing a plausible ranking later.

The `minimal` set (`0121`) is the one minE2E scores with, so it is read here as the shipped
catalog holds it rather than as a fixture invented to be convenient.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import (
    CriteriaSet,
    CriteriaSetInUseError,
    Goal,
    NormalisationMethod,
    PillarWeight,
    UnknownCriteriaSetError,
)
from starnest.data import UnknownAttributeError
from starnest.storage import PostgresCriteriaStore, PostgresEvaluationStore

pytestmark = pytest.mark.storage

MINIMAL = "minimal"
SHIPPED = "local_employment"
REMOTE_ONLY = "remote_only"

THE_ANCHORS_THE_HOUSEHOLD_CHOSE = {
    "country.total_tax_rate_effective": ((Decimal(35), 100), (Decimal(55), 0)),
    "country.housing_cost_overburden_rate": ((Decimal(5), 100), (Decimal(20), 0)),
    "country.tech_employment_share": ((Decimal(3), 0), (Decimal(7), 100)),
    "country.broadband_coverage": ((Decimal(80), 0), (Decimal(100), 100)),
    "country.life_satisfaction": ((Decimal(6), 0), (Decimal(8), 100)),
    "country.economic_outlook": ((Decimal(0), 0), (Decimal(3), 100)),
    "country.overcrowding_rate": ((Decimal(5), 100), (Decimal(30), 0)),
    "country.protected_land_share": ((Decimal(10), 0), (Decimal(40), 100)),
    "country.average_working_hours": ((Decimal(40), 100), (Decimal(48), 0)),
    "country.rail_network_density": ((Decimal(0), 0), (Decimal(100), 100)),
    "country.road_network_quality": ((Decimal(0), 0), (Decimal(40), 100)),
    "country.winter_daytime_temperature": ((Decimal(0), 0), (Decimal(15), 100)),
    "country.parental_leave_policy": ((Decimal(8), 0), (Decimal(90), 100)),
}
"""Every anchor the shipped set carries, each decided against real figures (Q206, Q209, Q212, Q213).

**Parental leave joined on 2026-09-19** (`0475`), against OECD PF2.1's full-rate equivalent --
Switzerland 8.05 weeks at the bottom, Romania 88.68 at the top. The pair is rounded outward to
8 and 90 rather than set on those two figures, so a refresh of the data cannot quietly move
what 0 and 100 mean.

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
        """43 criteria over the catalog's 44 attributes, four threshold shapes, and the rules
        the set enforces. The heavier read, and the one that would expose a mapper that only
        handles the simple case.

        **43 rather than 44**: `european_air_connectivity` is descriptive and no set scores it
        (Q228), which is the ontology's own category for a figure that is true and is not a
        basis for ranking.
        """
        shipped = await criteria.read_criteria_set(SHIPPED, level=COUNTRY)

        assert len(shipped.criteria) == 43
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

    async def test_the_remote_only_set_is_a_full_copy_and_not_an_overlay(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """`0469`. **A set is a full copy, never a sparse overlay** (`reqs.md` Q191): weights
        sum to 100 within a pillar, so a set holding only the rows it changed would carry a
        handful of overrides beside inherited weights and sum to something else entirely.

        Asserted as a *comparison* rather than as a roster: the same attributes and the same
        anchors as the set it was copied from, which stays true the day the catalog grows. The
        weights deliberately differ, and that is the only thing that may.
        """
        shipped = await criteria.read_criteria_set(SHIPPED, level=COUNTRY)
        remote = await criteria.read_criteria_set(REMOTE_ONLY, level=COUNTRY)

        assert {str(c.attribute) for c in remote.criteria} == {
            str(c.attribute) for c in shipped.criteria
        }
        assert {str(w.pillar) for w in remote.pillar_weights} == {
            str(w.pillar) for w in shipped.pillar_weights
        }
        # The anchors travel with the copy. Without them the eight `fixed` criteria the
        # household anchored would score nothing at all, and the set would look like the
        # shipped one while ranking on two thirds of it.
        assert {
            str(c.attribute): tuple((a.input_value, a.score) for a in c.scale_anchors)
            for c in remote.criteria
            if c.scale_anchors
        } == THE_ANCHORS_THE_HOUSEHOLD_CHOSE

    async def test_the_remote_only_set_weighs_the_same_attributes_differently(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """The point of a second set, and the thing a copy could accidentally not do.

        **`CriteriaSet` refuses to construct unless every pillar sums to 100**, so reading both
        objects at all is the real assertion that the re-weighting is coherent; this one only
        adds that it *is* a re-weighting rather than a duplicate under a new name.
        """
        shipped = await criteria.read_criteria_set(SHIPPED, level=COUNTRY)
        remote = await criteria.read_criteria_set(REMOTE_ONLY, level=COUNTRY)

        shipped_weights = {str(c.attribute): c.weight for c in shipped.criteria}
        remote_weights = {str(c.attribute): c.weight for c in remote.criteria}

        assert remote_weights != shipped_weights
        # The scenario's own statement: the connection is the job (`0469`).
        assert (
            remote_weights["country.broadband_coverage"]
            > shipped_weights["country.broadband_coverage"]
        )
        # And the local job market no longer decides where you may live.
        remote_career = next(w for w in remote.pillar_weights if str(w.pillar) == "career")
        shipped_career = next(w for w in shipped.pillar_weights if str(w.pillar) == "career")
        assert remote_career.weight < shipped_career.weight

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

    async def test_deleting_a_set_a_saved_evaluation_used_is_refused(
        self, criteria: PostgresCriteriaStore, pool: AsyncConnectionPool
    ) -> None:
        """**A saved evaluation holds its criteria set in place** (P60).

        `evaluation.criteria_set` references the set with no `ON DELETE`, so the delete used to
        reach the database and come back as a `ForeignKeyViolation` -- a driver type reaching
        `api/`, where an untranslated one is a 500 for a request that was merely refused. What
        should happen is a matter of design; a 500 is not one of the options. `household_store`
        already translates exactly this exception for exactly this reason.
        """
        held = "held_by_an_evaluation"
        await criteria.create_criteria_set(_a_set(held, weight="100"))
        evaluations = PostgresEvaluationStore(pool)
        await evaluations.save(
            criteria=await criteria.read_criteria_set(held, level=COUNTRY),
            level=COUNTRY,
            results=[],
            score_scale_max=100,
            computed_at=datetime(2026, 9, 16, 9, 0, tzinfo=UTC),
        )

        try:
            with pytest.raises(CriteriaSetInUseError, match=held):
                await criteria.delete_criteria_set(held)
            assert await criteria.read_criteria_set(held, level=COUNTRY) is not None
        finally:
            # The evaluation goes first, the way `conftest` empties it -- an evaluation has
            # children of its own, and a plain DELETE trips their foreign keys. That the
            # cleanup is this entangled is the argument for the refusal being tested: a
            # criteria set with a saved evaluation behind it is not a loose end to tidy.
            async with pool.connection() as connection:
                await connection.execute("TRUNCATE evaluation RESTART IDENTITY CASCADE")
            await criteria.delete_criteria_set(held)

    async def test_a_criterion_on_an_attribute_the_catalog_does_not_hold_is_refused(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """**Zero rows inserted is not success** (P61).

        `insert_criterion` is an `INSERT … SELECT … FROM attribute WHERE id = :attribute`, so an
        attribute the catalog does not hold matches nothing: no constraint fires, no row is
        written, and aiosql hands back `None`. The next line read `.id` off it and the request
        became an `AttributeError` -- a 500, after the set row and its pillar weights had already
        been written in the same transaction.

        The neighbouring case is already handled: a *pillar-less* attribute fails loudly on a
        `NOT NULL` (`0106`). One fails loudly, the other silently and then crashes.
        """
        invented = _a_set("names_an_invented_attribute", weight="100").model_copy(
            update={
                "criteria": (
                    _a_set("names_an_invented_attribute", weight="100")
                    .criteria[0]
                    .model_copy(update={"attribute": "country.net_median_salary"}),
                )
            }
        )

        with pytest.raises(UnknownAttributeError, match=r"country\.net_median_salary"):
            await criteria.create_criteria_set(invented)

        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set("names_an_invented_attribute")

    async def test_a_set_no_evaluation_used_still_deletes(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """The control: the refusal must protect a set an evaluation names, not every set."""
        await criteria.create_criteria_set(_a_set("held_by_nothing", weight="100"))

        await criteria.delete_criteria_set("held_by_nothing")

        with pytest.raises(UnknownCriteriaSetError):
            await criteria.read_criteria_set("held_by_nothing")


class TestTheThresholdShapesTheStoreCanWrite:
    """Three of the four threshold shapes were written and read by code no test ran.

    Found in the coverage audit of 2026-09-12: `criteria_store.py` sat at 81.3%, and the gap
    was the threshold branches. The shipped catalog uses range thresholds only, so the label,
    boolean and share paths were exercised by nothing -- which is exactly the shape of `P15`,
    where the store quietly failed to write the rule lists nobody read back.

    **A label threshold is testable and the other two are not, honestly.** No attribute in the
    catalog is a `Boolean` or a `ShareComposition` at any level, so a criterion carrying one of
    those thresholds cannot be built without inventing an attribute -- and an attribute invented
    by a test is a catalog this application does not ship. The branches stay uncovered and the
    reason is written here rather than papered over with a fixture that proves nothing.
    """

    async def test_a_label_threshold_survives_the_round_trip(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """`country.climate_zone` is a `LabelSet`, so its threshold names a label and how it
        must be contained -- and a `LabelSet` criterion may not be scored (`0122`)."""
        from starnest.criteria import LabelThreshold

        await criteria.create_criteria_set(
            _a_label_set(
                "label_threshold_round_trip",
                threshold=LabelThreshold(label="Cfb", containment_rule="must_contain"),
            )
        )
        try:
            read_back = await criteria.read_criteria_set(
                "label_threshold_round_trip", level=COUNTRY
            )
        finally:
            await criteria.delete_criteria_set("label_threshold_round_trip")

        threshold = read_back.criteria[0].matching_threshold
        assert isinstance(threshold, LabelThreshold)
        assert threshold.label == "Cfb"
        assert threshold.containment_rule == "must_contain"

    async def test_a_criterion_with_no_threshold_reads_back_with_none(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """The control: the same criterion, no threshold. Without it the test above passes for
        two reasons -- the threshold survived, or every read returns something label-shaped."""
        await criteria.create_criteria_set(_a_label_set("no_threshold_round_trip"))
        try:
            read_back = await criteria.read_criteria_set("no_threshold_round_trip", level=COUNTRY)
        finally:
            await criteria.delete_criteria_set("no_threshold_round_trip")

        assert read_back.criteria[0].matching_threshold is None


def _a_label_set(identifier: str, *, threshold: object = None) -> CriteriaSet:
    """One unscored criterion on a `LabelSet` attribute, which is the only shape the catalog
    offers for a label threshold."""
    from starnest.criteria import Criterion
    from starnest.data import ValueType

    return CriteriaSet(
        id=identifier,
        name=identifier,
        criteria=(
            Criterion(
                criteria_set=identifier,
                attribute="country.climate_zone",
                pillar="climate",
                value_type=ValueType.LABEL_SET,
                weight=Decimal(100),
                goal=Goal.MAXIMISE,
                normalisation_method=NormalisationMethod.PERCENTILE,
                # A `LabelSet` carries no magnitude, so it can be matched and never scored.
                is_scored=False,
                matching_threshold=threshold,
            ),
        ),
        pillar_weights=(PillarWeight(pillar="climate", level=COUNTRY, weight=Decimal(100)),),
    )


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

    async def test_an_anchor_keeps_its_label_because_it_travels_whole(
        self, criteria: PostgresCriteriaStore
    ) -> None:
        """**The three fields of an anchor cannot come apart any more** (D22).

        They were written as three parallel arrays, and `unnest` over several arrays pads the
        short ones with NULL rather than complaining -- caught for `score`, which is `NOT NULL`,
        and silent for `label`, which is not. So a labels array one entry short blanked every
        label it did not reach, and a blanked band label reads as a scale left deliberately
        unnamed. One JSON object per anchor removes the alignment rather than checking it.

        A guard was tried first and could not work: `CAST('...' AS integer)` inside a `CASE` is
        a constant expression, so PostgreSQL folds it at plan time and raises whether the
        lengths agree or not. Every anchor round trip in this file failed at once, which is the
        cheapest way that lesson could have been learned.
        """
        from starnest.criteria import ScaleAnchor

        built = _a_set(
            "anchors_travel_whole",
            weight="100",
            anchors=(
                ScaleAnchor(input_value=Decimal("4.5"), score=0, label="poor"),
                ScaleAnchor(input_value=Decimal(8), score=100, label=None),
            ),
        )

        await criteria.create_criteria_set(built)
        try:
            read_back = await criteria.read_criteria_set("anchors_travel_whole", level=COUNTRY)

            anchors = read_back.criterion_for("country.life_satisfaction").scale_anchors
            assert [(a.input_value, a.score, a.label) for a in anchors] == [
                # The decimal survives as a decimal: passed as text, cast in the statement,
                # never through a float (`arch.md` 9.6).
                (Decimal("4.5"), 0, "poor"),
                (Decimal(8), 100, None),
            ]
        finally:
            await criteria.delete_criteria_set("anchors_travel_whole")

    async def test_a_city_level_gate_does_not_reach_a_country_read(
        self, criteria: PostgresCriteriaStore, pool: AsyncConnectionPool
    ) -> None:
        """**`:level` narrowed the criteria and the pillar weights and not the rules** (D21).

        A set read at one level came back carrying every gate it enforces and every compound
        rule it applies, whatever level those were declared at -- so a city gate would be
        enforced against a country ranking, and `gates_that_rule_out` consults exactly this
        list. No live effect while every shipped rule is country-level, which is why it needed
        a city rule to show at all.
        """
        scratch = "rules_narrowed_by_level"
        # The gate has to exist before a set may enforce it, which the foreign key says first.
        async with pool.connection() as connection:
            await connection.execute(
                "INSERT INTO match_rule (id, level, name) VALUES"
                " ('city_curfew', 'city', 'A gate that belongs to cities')"
            )
        try:
            await criteria.create_criteria_set(
                _a_set(scratch, weight="100").model_copy(
                    update={"enforced_match_rules": frozenset({"eu_free_movement", "city_curfew"})}
                )
            )

            at_country = await criteria.read_criteria_set(scratch, level=COUNTRY)
            entire = await criteria.read_criteria_set(scratch)

            assert "city_curfew" not in at_country.enforced_match_rules
            assert "eu_free_movement" in at_country.enforced_match_rules
            # Read without a level, the set is its whole self -- which is what the criteria
            # screen shows and what a copy has to carry.
            assert "city_curfew" in entire.enforced_match_rules
        finally:
            await criteria.delete_criteria_set(scratch)
            async with pool.connection() as connection:
                await connection.execute("DELETE FROM match_rule WHERE id = 'city_curfew'")
