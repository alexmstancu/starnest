"""What makes a criterion a rule, and what makes it an unreadable one.

**The error contract.** Constructing a criterion goes through Pydantic, so a domain error
arrives wrapped in `ValidationError` -- itself a `ValueError`, with the message intact. The
tests below expect `ValueError` for that reason and match on the message, which is the part a
reader sees.

Every refusal here is a combination the *schema* also refuses. The duplication is deliberate
(`arch.md` 3.3b): the database is authoritative, and the domain check exists where naming the
problem in a sentence is worth more than a constraint violation.
"""

from decimal import Decimal

import pytest

from starnest.criteria import (
    Criterion,
    CriterionDeclarationError,
    Goal,
    LabelThreshold,
    NormalisationMethod,
    RangeThreshold,
    ReducerMode,
    ScaleAnchor,
)
from starnest.data import ValueType

SET = "local_employment"
RENT = "country.rent_centre"


def criterion(**overrides: object) -> Criterion:
    """A criterion that is valid, so each test changes exactly the one thing it is about."""
    fields: dict[str, object] = {
        "criteria_set": SET,
        "attribute": RENT,
        "value_type": ValueType.MONETARY,
        "pillar": "housing",
        "weight": Decimal("100"),
        "goal": Goal.MINIMISE,
    }
    fields.update(overrides)
    return Criterion(**fields)  # type: ignore[arg-type]


def test_a_criterion_carries_the_attributes_level_without_storing_it() -> None:
    """The level is already half of the attribute's identifier (`reqs.md` 3.3), so storing it
    again would be a second copy that could disagree with the first."""
    assert criterion().attribute.level_id == "country"


# --- the target range ---------------------------------------------------------


def test_a_target_range_goal_without_a_band_is_refused() -> None:
    """A target range is four numbers and the band is two of them; without it nothing scores
    100 and the goal says nothing at all."""
    with pytest.raises(ValueError, match="names no band"):
        criterion(goal=Goal.TARGET_RANGE)


def test_a_target_range_goal_with_only_one_edge_is_refused() -> None:
    with pytest.raises(ValueError, match="names no band"):
        criterion(goal=Goal.TARGET_RANGE, target_range_min=Decimal("18"))


def test_a_backwards_band_is_refused() -> None:
    with pytest.raises(ValueError, match="backwards"):
        criterion(
            goal=Goal.TARGET_RANGE,
            target_range_min=Decimal("26"),
            target_range_max=Decimal("18"),
        )


def test_a_full_target_range_is_accepted() -> None:
    """The worked example of `reqs.md` 5.1: 18-26 degrees scores 100, falling to 0 at 5 and 38."""
    temperate = criterion(
        attribute="country.avg_annual_temperature",
        value_type=ValueType.QUANTITY,
        pillar="climate",
        goal=Goal.TARGET_RANGE,
        target_range_min=Decimal("18"),
        target_range_max=Decimal("26"),
        zero_score_below=Decimal("5"),
        zero_score_above=Decimal("38"),
    )

    assert temperate.goal is Goal.TARGET_RANGE


@pytest.mark.parametrize(
    "field,value,complaint",
    [
        ("zero_score_below", "20", "inside its target band starting at"),
        ("zero_score_above", "24", "inside its target band ending at"),
    ],
)
def test_a_falloff_point_inside_the_band_is_refused(field: str, value: str, complaint: str) -> None:
    """A value that scores both 100 and 0 is not a stricter rule, it is an unreadable one."""
    with pytest.raises(ValueError, match=complaint):
        criterion(
            goal=Goal.TARGET_RANGE,
            target_range_min=Decimal("18"),
            target_range_max=Decimal("26"),
            **{field: Decimal(value)},
        )


def test_the_bounds_are_permitted_on_a_goal_that_ignores_them() -> None:
    """The schema permits it, so refusing here would make the domain stricter than the
    constraint for no gain -- and a user switching goal to compare readings would lose the
    numbers they had typed."""
    minimising = criterion(target_range_min=Decimal("500"), target_range_max=Decimal("900"))

    assert minimising.goal is Goal.MINIMISE


# --- breakdowns ---------------------------------------------------------------


def test_selecting_a_breakdown_option_without_naming_one_is_refused() -> None:
    with pytest.raises(ValueError, match="names none"):
        criterion(reducer_mode=ReducerMode.SELECT)


def test_aggregating_while_naming_one_option_is_refused() -> None:
    """Aggregating across every option and picking one are opposite instructions."""
    with pytest.raises(ValueError, match="does one or the other"):
        criterion(reducer_mode=ReducerMode.AGGREGATE, breakdown_option="two_bedroom")


def test_selecting_a_named_option_is_accepted() -> None:
    selected = criterion(reducer_mode=ReducerMode.SELECT, breakdown_option="two_bedroom")

    assert selected.breakdown_option == "two_bedroom"


def test_an_option_without_a_reducer_mode_is_accepted() -> None:
    """The schema allows it, and it is how a default arrives from the household before the
    user has expressed any opinion about reduction."""
    assert criterion(breakdown_option="two_bedroom").reducer_mode is None


# --- the scale ----------------------------------------------------------------


def test_a_fixed_criterion_with_no_anchors_is_accepted() -> None:
    """26 of the 41 shipped country criteria normalise `fixed` and none ships an anchor.
    Requiring one here would force someone to invent a number, which `devplan.md` 0.3
    forbids."""
    unscaled = criterion(normalisation_method=NormalisationMethod.FIXED)

    assert unscaled.scale_anchors == ()
    assert not unscaled.declares_a_readable_scale, "it is legal, and it cannot yet be scored"


def test_a_single_anchor_is_refused() -> None:
    """Zero anchors is a decision deferred; one is a half-finished edit. A single point fixes
    no line, so no other value has a score."""
    with pytest.raises(ValueError, match="at least two points"):
        criterion(scale_anchors=(ScaleAnchor(input_value=Decimal("500"), score=100),))


def test_two_anchors_describe_a_readable_scale() -> None:
    scaled = criterion(
        scale_anchors=(
            ScaleAnchor(input_value=Decimal("500"), score=100),
            ScaleAnchor(input_value=Decimal("2500"), score=0),
        )
    )

    assert scaled.declares_a_readable_scale


def test_anchoring_one_input_twice_is_refused() -> None:
    """It would map one value to two scores, which the table's primary key also forbids."""
    with pytest.raises(ValueError, match="twice"):
        criterion(
            scale_anchors=(
                ScaleAnchor(input_value=Decimal("500"), score=100),
                ScaleAnchor(input_value=Decimal("500"), score=0),
            )
        )


@pytest.mark.parametrize("method", [NormalisationMethod.PERCENTILE, NormalisationMethod.AS_IS])
def test_a_scale_is_readable_when_the_method_needs_no_anchors(
    method: NormalisationMethod,
) -> None:
    """Only `fixed` interpolates between anchors. Percentile ranks within the candidate set
    and `as_is` is already on the score scale."""
    assert criterion(normalisation_method=method).declares_a_readable_scale


# --- band labels --------------------------------------------------------------


def test_a_band_label_names_the_span_starting_at_its_anchor() -> None:
    """`reqs.md` 5.1: a number displays as a word without ceasing to be a number. The label
    belongs to the band from its anchor up to the next, not to the single point."""
    labelled = criterion(
        scale_anchors=(
            ScaleAnchor(input_value=Decimal("500"), score=100, label="affordable"),
            ScaleAnchor(input_value=Decimal("1500"), score=40, label="stretching"),
        )
    )

    assert labelled.band_label_for(Decimal("500")) == "affordable"
    assert labelled.band_label_for(Decimal("1400")) == "affordable"
    assert labelled.band_label_for(Decimal("1500")) == "stretching"
    assert labelled.band_label_for(Decimal("9000")) == "stretching"


def test_a_figure_below_every_anchor_has_no_band() -> None:
    """Not an error: a scale that starts higher than the value being read simply has no word
    for it, and inventing one would put a label on a figure nobody described."""
    labelled = criterion(
        scale_anchors=(
            ScaleAnchor(input_value=Decimal("500"), score=100, label="affordable"),
            ScaleAnchor(input_value=Decimal("1500"), score=40, label="stretching"),
        )
    )

    assert labelled.band_label_for(Decimal("100")) is None


def test_an_unlabelled_anchor_contributes_no_band() -> None:
    """Labels are optional per anchor, so a scale may label only its extremes."""
    partly = criterion(
        scale_anchors=(
            ScaleAnchor(input_value=Decimal("500"), score=100),
            ScaleAnchor(input_value=Decimal("1500"), score=40, label="stretching"),
        )
    )

    assert partly.band_label_for(Decimal("600")) is None
    assert partly.band_label_for(Decimal("1600")) == "stretching"


def test_an_unlabelled_anchor_ends_the_band_below_it() -> None:
    """The band an anchor starts is deliberately unnamed, so a figure inside it has no word.

    The mirror of the case above, and the one that bites: here the unlabelled anchor sits
    *between* two labelled ones, so reading the highest labelled anchor at or below the figure
    would carry the lower band's word right through a band that was never given one -- a rent
    of 2,999 displaying as "affordable" beside a number that says otherwise.
    """
    partly = criterion(
        scale_anchors=(
            ScaleAnchor(input_value=Decimal("500"), score=100, label="affordable"),
            ScaleAnchor(input_value=Decimal("1500"), score=40),
            ScaleAnchor(input_value=Decimal("3000"), score=0, label="unaffordable"),
        )
    )

    assert partly.band_label_for(Decimal("1400")) == "affordable"
    assert partly.band_label_for(Decimal("1500")) is None
    assert partly.band_label_for(Decimal("2999")) is None
    assert partly.band_label_for(Decimal("3000")) == "unaffordable"


def test_a_criterion_with_no_anchors_has_no_band_for_anything() -> None:
    assert criterion().band_label_for(Decimal("500")) is None


@pytest.mark.parametrize("label", ["", "   "])
def test_a_blank_band_label_is_refused(label: str) -> None:
    """Absence is `None`. A blank label is a band that displays as nothing, which puts empty
    space on the screen where the number should have been."""
    with pytest.raises(ValueError, match="a word or it is absent"):
        ScaleAnchor(input_value=Decimal("500"), score=100, label=label)


def test_a_negative_anchor_score_is_refused() -> None:
    """Mirrors `criterion_scale_anchor_score_is_not_negative`. There is deliberately no upper
    bound: the score scale is configurable (`reqs.md` 5.1), and pinning 100 here would
    hardcode it."""
    with pytest.raises(ValueError):
        ScaleAnchor(input_value=Decimal("500"), score=-1)


# --- thresholds ---------------------------------------------------------------


def test_a_threshold_of_the_wrong_shape_for_the_value_type_is_refused() -> None:
    """The same pairing the composite key of `arch.md` 3.3b refuses at insert -- caught here
    so the message names what the shape does judge."""
    with pytest.raises(ValueError, match="cannot judge"):
        criterion(matching_threshold=LabelThreshold(label="x", containment_rule="must_contain"))


def test_a_threshold_suiting_the_value_type_is_accepted() -> None:
    bounded = criterion(matching_threshold=RangeThreshold(max_value=Decimal("2000")))

    assert bounded.matching_threshold is not None


def test_a_criterion_needs_no_threshold() -> None:
    """Most criteria only score. A threshold is what lets one say `not_matching` as well
    (`reqs.md` 5.2), and it is a separate decision from weighting."""
    assert criterion().matching_threshold is None


# --- exclusion and blocking ---------------------------------------------------


def test_excluding_a_criterion_takes_it_out_of_coverage_too() -> None:
    """`is_scored: false` means *you decided this does not apply*, so nothing is missing and
    coverage is unaffected (`reqs.md` 5.3). Counting it as a gap would penalise a candidate
    for data the user said was irrelevant."""
    assert not criterion(is_scored=False).counts_toward_coverage
    assert criterion().counts_toward_coverage


def test_blocking_and_excluding_are_independent() -> None:
    """The two answer different questions, and their earlier names -- `included` and
    `required` -- sounded close enough to be confused."""
    blocking = criterion(blocks_if_missing=True, is_scored=False)

    assert blocking.blocks_if_missing
    assert not blocking.is_scored


# --- the frame ----------------------------------------------------------------


def test_a_criterion_is_frozen() -> None:
    """A weight change rewrites its siblings, so an edit produces a new set rather than
    mutating one that would sum to the wrong total in between."""
    with pytest.raises(ValueError):
        criterion().weight = Decimal("50")


@pytest.mark.parametrize("weight", ["-1", "101"])
def test_a_weight_outside_zero_to_one_hundred_is_refused(weight: str) -> None:
    """Percentages, 0-100 (`reqs.md` Q185), mirroring `criterion_weight_is_a_percentage`."""
    with pytest.raises(ValueError):
        criterion(weight=Decimal(weight))


def test_an_unknown_field_is_refused() -> None:
    """`extra="forbid"`. A misspelled field silently ignored is a preference the user
    expressed and the application discarded."""
    with pytest.raises(ValueError):
        criterion(blocks_if_absent=True)


def test_a_malformed_attribute_identifier_is_refused() -> None:
    """`<level>.<name>`, exactly two segments. A one-segment identifier has no level, and the
    level is what `criteria_under` groups by."""
    with pytest.raises(ValueError):
        criterion(attribute="rent_centre")


def test_the_declaration_error_is_a_value_error() -> None:
    """The house contract: every fault in this module is a `ValueError` or a `LookupError`."""
    assert issubclass(CriterionDeclarationError, ValueError)
