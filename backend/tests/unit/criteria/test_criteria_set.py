"""What a criteria set refuses to be, and what a weight change does to its siblings.

The invariant under test throughout is the one that belongs to no single row: **weights sum to
100 within a pillar across criteria, and within a level across pillars**. A set that breaks it
does not fail loudly -- it produces a ranking computed from the wrong total, which is the
failure this application exists to prevent.
"""

from decimal import Decimal

import pytest

from starnest.criteria import (
    CriteriaSet,
    CriteriaSetError,
    Criterion,
    CriterionDeclarationError,
    Goal,
    PillarWeight,
    ScaleAnchor,
    UnknownCriterionError,
    WeightsAllLockedError,
)
from starnest.data import ValueType

SET = "local_employment"


def criterion(
    attribute: str,
    weight: str,
    *,
    pillar: str = "housing",
    criteria_set: str = SET,
    locked: bool = False,
    anchors: tuple[ScaleAnchor, ...] = (),
) -> Criterion:
    return Criterion(
        criteria_set=criteria_set,
        attribute=attribute,
        value_type=ValueType.MONETARY,
        pillar=pillar,
        weight=Decimal(weight),
        weight_locked=locked,
        goal=Goal.MINIMISE,
        scale_anchors=anchors,
    )


def pillar_weight(
    pillar: str, weight: str, *, level: str = "country", locked: bool = False
) -> PillarWeight:
    return PillarWeight(pillar=pillar, level=level, weight=Decimal(weight), weight_locked=locked)


def a_set(criteria: tuple[Criterion, ...], weights: tuple[PillarWeight, ...]) -> CriteriaSet:
    return CriteriaSet(id=SET, name="Local employment", criteria=criteria, pillar_weights=weights)


def one_pillar() -> CriteriaSet:
    """Three criteria in one pillar, that pillar carrying the whole level."""
    return a_set(
        (
            criterion("country.rent_centre", "20"),
            criterion("country.house_price", "40"),
            criterion("country.mortgage_rate", "40"),
        ),
        (pillar_weight("housing", "100"),),
    )


# --- what a set refuses to be -------------------------------------------------


def test_an_empty_set_is_legal() -> None:
    """The sum rule applies per group, and a set with no criteria has no groups. This is what
    a set looks like the moment before its first criterion is added."""
    empty = CriteriaSet(id="alex", name="Alex")

    assert empty.criteria == ()
    assert empty.levels == ()


def test_criteria_whose_weights_do_not_sum_to_one_hundred_are_refused() -> None:
    with pytest.raises(ValueError, match="sum to 90, not 100"):
        a_set(
            (criterion("country.rent_centre", "50"), criterion("country.house_price", "40")),
            (pillar_weight("housing", "100"),),
        )


def test_pillar_weights_that_do_not_sum_to_one_hundred_are_refused() -> None:
    with pytest.raises(ValueError, match="pillar weights at level country"):
        a_set(
            (criterion("country.rent_centre", "100"),),
            (pillar_weight("housing", "60"), pillar_weight("safety", "10")),
        )


def test_each_level_sums_independently_of_the_other() -> None:
    """`reqs.md` 7: weights sum to 100 WITHIN a level. Two levels each summing to 100 is
    correct, and a set that summed them together would total 200 and score nothing."""
    both = a_set(
        (criterion("country.rent_centre", "100"), criterion("city.rent_centre", "100")),
        (pillar_weight("housing", "100"), pillar_weight("housing", "100", level="city")),
    )

    assert both.levels == ("city", "country")


def test_the_same_pillar_at_two_levels_is_not_a_duplicate() -> None:
    """A set holds one opinion about housing at country level and a different one at city
    level (`reqs.md` Q187), so the key is the pair and not the pillar alone."""
    both = a_set(
        (criterion("country.rent_centre", "100"), criterion("city.rent_centre", "100")),
        (pillar_weight("housing", "100"), pillar_weight("housing", "100", level="city")),
    )

    assert len(both.pillar_weights) == 2


def test_weighting_one_pillar_twice_at_one_level_is_refused() -> None:
    with pytest.raises(ValueError, match="weights the same pillar twice"):
        a_set(
            (criterion("country.rent_centre", "100"),),
            (pillar_weight("housing", "50"), pillar_weight("housing", "50")),
        )


def test_two_rules_on_one_attribute_are_refused() -> None:
    """Not stricter but ambiguous: there would be no answer to which goal applies."""
    with pytest.raises(ValueError, match="two rules on the same attribute"):
        a_set(
            (criterion("country.rent_centre", "50"), criterion("country.rent_centre", "50")),
            (pillar_weight("housing", "100"),),
        )


def test_a_criterion_belonging_to_another_set_is_refused() -> None:
    """Sets are full copies (`reqs.md` Q191). A row pointing elsewhere means a copy that was
    not re-pointed, and it would be edited through two sets at once."""
    with pytest.raises(ValueError, match="belongs to set"):
        a_set(
            (criterion("country.rent_centre", "100", criteria_set="alex"),),
            (pillar_weight("housing", "100"),),
        )


def test_a_criterion_in_a_pillar_carrying_no_weight_is_refused() -> None:
    """Its contribution is its score times its weight in the pillar times the pillar's weight
    in the level. With no pillar weight that product is undefined, and reporting it as zero
    would drop the criterion out of a ranking still claiming full coverage."""
    with pytest.raises(ValueError, match="carries no weight at level country"):
        a_set(
            (criterion("country.homicide_rate", "100", pillar="safety"),),
            (pillar_weight("housing", "100"),),
        )


def test_a_pillar_with_no_criteria_is_reported_rather_than_refused() -> None:
    """The reverse case, deliberately allowed: seeding a level's pillar weights before its
    criteria is how a level gets built. Refusing it would make a legitimate intermediate state
    unconstructable, so it is surfaced instead."""
    lopsided = a_set(
        (criterion("country.rent_centre", "100"),),
        (pillar_weight("housing", "60"), pillar_weight("safety", "40")),
    )

    assert lopsided.pillars_with_no_criteria == (("safety", "country"),)
    assert one_pillar().pillars_with_no_criteria == ()


def test_excluded_criteria_still_count_toward_the_sum() -> None:
    """`is_scored: false` redistributes weight at scoring time (`reqs.md` 5.3); it does not
    renumber the stored rows. Skipping them here would let a set that sums to 100 become one
    that sums to 60 by unticking boxes, and the redistribution downstream would then divide by
    the wrong total."""
    with pytest.raises(ValueError, match="sum to 40, not 100"):
        a_set(
            (
                criterion("country.rent_centre", "40"),
                Criterion(
                    criteria_set=SET,
                    attribute="country.house_price",
                    value_type=ValueType.MONETARY,
                    pillar="housing",
                    weight=Decimal("0"),
                    goal=Goal.MINIMISE,
                    is_scored=False,
                ),
            ),
            (pillar_weight("housing", "100"),),
        )


# --- reading ------------------------------------------------------------------


def test_a_criterion_can_be_found_by_its_attribute() -> None:
    assert one_pillar().criterion_for("country.rent_centre").weight == Decimal("20")


def test_asking_for_an_attribute_this_set_does_not_judge_raises() -> None:
    """A `LookupError` rather than `None`: an absent criterion means the attribute is
    descriptive here, and a caller that quietly scored a `None` would invent an opinion."""
    with pytest.raises(UnknownCriterionError, match="imposes no rule"):
        one_pillar().criterion_for("country.homicide_rate")


def test_criteria_are_grouped_by_pillar_and_level_together() -> None:
    """The group the sum rule applies to is the pair, so a same-named pillar at another level
    must not be swept in."""
    both = a_set(
        (criterion("country.rent_centre", "100"), criterion("city.rent_centre", "100")),
        (pillar_weight("housing", "100"), pillar_weight("housing", "100", level="city")),
    )

    assert len(both.criteria_under("housing", "country")) == 1
    assert both.criteria_under("housing", "country")[0].attribute == "country.rent_centre"


def test_a_pillar_with_nothing_under_it_yields_an_empty_group() -> None:
    assert one_pillar().criteria_under("safety", "country") == ()


# --- duplication --------------------------------------------------------------


def test_duplicating_re_points_every_criterion() -> None:
    """A set is a full copy, not an overlay (`reqs.md` Q191). A row still pointing at the
    original would be edited through both sets at once."""
    copy = one_pillar().duplicated_as("alex", "Alex")

    assert copy.id == "alex"
    assert copy.name == "Alex"
    assert {criterion.criteria_set for criterion in copy.criteria} == {"alex"}
    assert len(copy.criteria) == 3


def test_duplicating_leaves_the_original_untouched() -> None:
    original = one_pillar()

    original.duplicated_as("alex", "Alex")

    assert {criterion.criteria_set for criterion in original.criteria} == {SET}


def test_a_duplicate_carries_the_enforced_rules_too() -> None:
    """The gates a reading enforces are part of that reading, so a copy that dropped them
    would silently be a more permissive set than the one it was copied from."""
    enforcing = CriteriaSet(
        id=SET,
        name="Local employment",
        criteria=(criterion("country.rent_centre", "100"),),
        pillar_weights=(pillar_weight("housing", "100"),),
        enforced_match_rules=frozenset({"eu_free_movement"}),
        applied_compound_rules=frozenset({"cheap_but_taxed"}),
    )

    copy = enforcing.duplicated_as("alex", "Alex")

    assert copy.enforced_match_rules == frozenset({"eu_free_movement"})
    assert copy.applied_compound_rules == frozenset({"cheap_but_taxed"})


def test_a_malformed_new_identifier_is_refused() -> None:
    with pytest.raises(ValueError):
        one_pillar().duplicated_as("Alex's Set", "Alex")


# --- the two flags ------------------------------------------------------------


def test_excluding_a_criterion_from_scoring_leaves_every_weight_where_it_was() -> None:
    """`is_scored` decides whether a criterion contributes, not what anything weighs.

    Its weight is redistributed at scoring time along with every other missing contribution
    (`reqs.md` 5.3), so rebalancing here would move weights nobody asked to move -- and would
    make excluding a criterion and then including it again a lossy round trip.
    """
    excluded = one_pillar().with_criterion_flags("country.rent_centre", is_scored=False)

    assert excluded.criterion_for("country.rent_centre").is_scored is False
    assert excluded.criterion_for("country.rent_centre").weight == Decimal("20")
    assert excluded.criterion_for("country.house_price").weight == Decimal("40")


def test_locking_a_weight_changes_only_who_absorbs_the_next_change() -> None:
    locked = one_pillar().with_criterion_flags("country.rent_centre", weight_locked=True)

    assert locked.criterion_for("country.rent_centre").weight_locked is True
    assert sum(c.weight for c in locked.criteria) == Decimal("100")


def test_setting_a_flag_leaves_the_old_set_alone() -> None:
    original = one_pillar()

    original.with_criterion_flags("country.rent_centre", is_scored=False)

    assert original.criterion_for("country.rent_centre").is_scored is True


def test_setting_a_flag_on_a_criterion_nobody_has_raises() -> None:
    with pytest.raises(UnknownCriterionError):
        one_pillar().with_criterion_flags("country.nobody_measures_this", is_scored=False)


# --- moving a weight ----------------------------------------------------------


def test_raising_one_criterion_lowers_its_siblings_and_keeps_the_sum() -> None:
    adjusted = one_pillar().with_criterion_weight("country.rent_centre", Decimal("40"))

    assert adjusted.criterion_for("country.rent_centre").weight == Decimal("40")
    assert adjusted.criterion_for("country.house_price").weight == Decimal("30")
    assert sum(c.weight for c in adjusted.criteria) == Decimal("100")


def test_a_weight_change_returns_a_new_set_and_leaves_the_old_one_alone() -> None:
    """Frozen for a reason: an in-place edit would leave the set summing to something other
    than 100 for as long as the caller took to finish."""
    original = one_pillar()

    original.with_criterion_weight("country.rent_centre", Decimal("40"))

    assert original.criterion_for("country.rent_centre").weight == Decimal("20")


def test_a_weight_change_never_reaches_another_pillar() -> None:
    """Weights sum within a pillar, so a pillar's siblings are the only ones with anything to
    absorb -- touching another pillar would break a sum that was correct."""
    two_pillars = a_set(
        (
            criterion("country.rent_centre", "60"),
            criterion("country.house_price", "40"),
            criterion("country.homicide_rate", "100", pillar="safety"),
        ),
        (pillar_weight("housing", "70"), pillar_weight("safety", "30")),
    )

    adjusted = two_pillars.with_criterion_weight("country.rent_centre", Decimal("20"))

    assert adjusted.criterion_for("country.homicide_rate").weight == Decimal("100")
    assert adjusted.criterion_for("country.house_price").weight == Decimal("80")


def test_a_locked_sibling_holds_its_weight() -> None:
    locked = a_set(
        (
            criterion("country.rent_centre", "20"),
            criterion("country.house_price", "30", locked=True),
            criterion("country.mortgage_rate", "50"),
        ),
        (pillar_weight("housing", "100"),),
    )

    adjusted = locked.with_criterion_weight("country.rent_centre", Decimal("30"))

    assert adjusted.criterion_for("country.house_price").weight == Decimal("30")
    assert adjusted.criterion_for("country.mortgage_rate").weight == Decimal("40")


def test_moving_a_weight_when_every_sibling_is_locked_is_refused() -> None:
    """The interface must say which locks block it rather than silently break the sum
    (`reqs.md` 3.4)."""
    locked = a_set(
        (
            criterion("country.rent_centre", "20"),
            criterion("country.house_price", "40", locked=True),
            criterion("country.mortgage_rate", "40", locked=True),
        ),
        (pillar_weight("housing", "100"),),
    )

    with pytest.raises(WeightsAllLockedError) as refused:
        locked.with_criterion_weight("country.rent_centre", Decimal("30"))

    assert refused.value.locked == ("country.house_price", "country.mortgage_rate")


def test_moving_a_criterion_whose_own_weight_is_locked_is_refused() -> None:
    """The lock is on the criterion being dragged, and it is honoured there too.

    Its siblings have all the room in the world, so nothing but the lock itself refuses this
    -- which is what makes it a test of the lock rather than of the arithmetic.
    """
    locked = a_set(
        (
            criterion("country.rent_centre", "20", locked=True),
            criterion("country.house_price", "40"),
            criterion("country.mortgage_rate", "40"),
        ),
        (pillar_weight("housing", "100"),),
    )

    with pytest.raises(WeightsAllLockedError) as refused:
        locked.with_criterion_weight("country.rent_centre", Decimal("30"))

    assert refused.value.locked == ("country.rent_centre",)


def test_a_sole_criterion_in_a_pillar_cannot_be_moved() -> None:
    """It is already 100% of its pillar, and there is nothing to absorb a change."""
    with pytest.raises(WeightsAllLockedError):
        a_set(
            (criterion("country.rent_centre", "100"),), (pillar_weight("housing", "100"),)
        ).with_criterion_weight("country.rent_centre", Decimal("60"))


def test_moving_a_weight_this_set_does_not_carry_raises() -> None:
    with pytest.raises(UnknownCriterionError):
        one_pillar().with_criterion_weight("country.homicide_rate", Decimal("40"))


# --- moving a pillar weight ---------------------------------------------------


def test_raising_one_pillar_lowers_the_others_at_that_level() -> None:
    """The same arithmetic over the other of the two levels of weighting, which is why
    `rebalance` is written once against an identifier and a number."""
    two_pillars = a_set(
        (
            criterion("country.rent_centre", "100"),
            criterion("country.homicide_rate", "100", pillar="safety"),
        ),
        (pillar_weight("housing", "40"), pillar_weight("safety", "60")),
    )

    adjusted = two_pillars.with_pillar_weight("housing", "country", Decimal("70"))

    assert {(w.pillar, w.weight) for w in adjusted.pillar_weights} == {
        ("housing", Decimal("70")),
        ("safety", Decimal("30")),
    }


def test_a_pillar_weight_change_never_reaches_another_level() -> None:
    """Each level sums to 100 independently, so a change absorbed across levels would break
    the level it was not aimed at."""
    both = a_set(
        (criterion("country.rent_centre", "100"), criterion("city.rent_centre", "100")),
        (
            pillar_weight("housing", "40"),
            pillar_weight("safety", "60"),
            pillar_weight("housing", "100", level="city"),
        ),
    )

    adjusted = both.with_pillar_weight("housing", "country", Decimal("70"))

    city = [w for w in adjusted.pillar_weights if w.level == "city"]
    assert city[0].weight == Decimal("100")


def test_moving_a_pillar_weight_this_level_does_not_carry_raises() -> None:
    with pytest.raises(UnknownCriterionError, match="carries no weight for pillar"):
        one_pillar().with_pillar_weight("safety", "country", Decimal("40"))


def test_moving_a_pillar_weight_at_a_level_this_set_does_not_reach_raises() -> None:
    """The pillar exists, the level does not. Narrowing by the wrong level is a likelier
    mistake than naming a pillar that was never seeded."""
    with pytest.raises(UnknownCriterionError):
        one_pillar().with_pillar_weight("housing", "city", Decimal("40"))


def test_the_set_error_is_a_value_error() -> None:
    assert issubclass(CriteriaSetError, ValueError)
    assert issubclass(UnknownCriterionError, LookupError)


# --- anchors against the score scale (known-issues D25) -------------------------

A_SMALL_SCALE = 10
"""Not 100, so a score of 50 is inside a hardcoded ceiling and outside the one in force."""


def _a_set_whose_second_criterion_overshoots(score: int) -> CriteriaSet:
    """Two criteria in one pillar; only the second anchors anything."""
    return a_set(
        (
            criterion("country.rent_centre", "60"),
            criterion(
                "country.house_price_to_income_ratio",
                "40",
                anchors=(
                    ScaleAnchor(input_value=Decimal("3"), score=score),
                    ScaleAnchor(input_value=Decimal("12"), score=0),
                ),
            ),
        ),
        (pillar_weight("housing", "100"),),
    )


def test_a_set_whose_anchors_all_fit_is_accepted() -> None:
    """The control."""
    _a_set_whose_second_criterion_overshoots(A_SMALL_SCALE).refuse_unless_its_anchors_fit(
        A_SMALL_SCALE
    )


def test_a_set_is_refused_when_any_one_of_its_criteria_overshoots() -> None:
    """The whole-set guarantee is one call, so a caller cannot check all but one."""
    overshooting = _a_set_whose_second_criterion_overshoots(50)

    with pytest.raises(CriterionDeclarationError, match="house_price_to_income_ratio"):
        overshooting.refuse_unless_its_anchors_fit(A_SMALL_SCALE)
