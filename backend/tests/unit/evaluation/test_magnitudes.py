"""The one number a value contributes, and the values that contribute none.

Six of the ten value types carry a comparable figure. The other four are matched against
thresholds and never scored (`reqs.md` 3.3a), and the difference matters here because reading a
figure that does not exist is how a score gets fabricated.
"""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.criteria import Goal, NormalisationMethod
from starnest.data import (
    PAYLOAD_CLASSES,
    AssignedScore,
    Assigner,
    Boolean,
    Count,
    Index,
    LabelSet,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    ValueType,
)
from starnest.evaluation import (
    UnscoreableValueError,
    figure_of,
    is_scoreable,
    magnitude_of,
    scores_for,
    threshold_reading,
)

from .builders import a_criterion, a_value


class TestTheSixTypesThatCarryAFigure:
    def test_money_is_read_as_its_euro_equivalent(self) -> None:
        """The load-bearing case. 2,900 CHF against 1,410 EUR as bare numbers is the failure
        the currency rule exists to prevent, and it fails silently (`reqs.md` 5.5)."""
        converted = Monetary(
            amount=Decimal("2900"),
            currency="CHF",
            amount_eur=Decimal("3045.00"),
            fx_rate=Decimal("1.05"),
            fx_rate_date=date(2026, 7, 1),
            fx_rate_source="ecb",
        )

        figure = magnitude_of(a_value(value_type=ValueType.MONETARY, payload=converted))

        assert figure == Decimal("3045.00")
        assert figure != Decimal("2900"), "the published figure is not comparable across places"

    def test_a_quantity_is_read_as_its_magnitude(self) -> None:
        value = a_value(
            value_type=ValueType.QUANTITY,
            payload=Quantity(magnitude=Decimal("12.4"), unit="celsius"),
        )
        assert magnitude_of(value) == Decimal("12.4")

    def test_a_count_is_read_as_a_number(self) -> None:
        assert magnitude_of(a_value(payload=Count(count=42))) == Decimal(42)

    def test_a_ratio_is_read_as_its_share(self) -> None:
        value = a_value(
            value_type=ValueType.RATIO, payload=Ratio(value=Decimal("17.5"), basis="households")
        )
        assert magnitude_of(value) == Decimal("17.5")

    def test_an_index_is_read_as_published_and_never_rescaled(self) -> None:
        """Rescaling from an index's declared bounds would be `fixed` normalisation by another
        name, without the anchors that make a fixed scale inspectable."""
        value = a_value(
            value_type=ValueType.INDEX,
            payload=Index(
                value=Decimal("71.4"),
                provider="Numbeo",
                scale_min=Decimal(0),
                scale_max=Decimal(100),
            ),
        )
        assert magnitude_of(value) == Decimal("71.4")

    def test_an_assigned_score_is_read_as_its_value(self) -> None:
        judged = AssignedScore(
            value=Decimal("6"),
            range_min=Decimal(0),
            range_max=Decimal(10),
            assigned_by=Assigner.HUMAN,
        )
        assert magnitude_of(a_value(value_type=ValueType.ASSIGNED_SCORE, payload=judged)) == 6


class TestTheValuesThatCarryNoFigure:
    def test_a_type_with_no_comparable_figure_is_refused(self) -> None:
        """There is no arithmetic that puts one climate zone above another."""
        labelled = a_value(value_type=ValueType.LABEL_SET, payload=LabelSet(labels=("Cfb", "Csa")))

        with pytest.raises(UnscoreableValueError, match="never scored"):
            magnitude_of(labelled)

    def test_a_boolean_is_refused_although_it_looks_numeric(self) -> None:
        """True is not 1. A gate answer is matched, not averaged into a total."""
        with pytest.raises(UnscoreableValueError, match="never scored"):
            magnitude_of(a_value(value_type=ValueType.BOOLEAN, payload=Boolean(value=True)))

    def test_a_rejected_value_holding_nothing_is_refused_with_its_reason(self) -> None:
        """The reason travels, because "no figure" and "a figure we refused" are different
        things to show in a drill-down."""
        rejected = a_value(payload=None, rejection_reason="the source returned a negative count")

        with pytest.raises(UnscoreableValueError, match="negative count"):
            magnitude_of(rejected)


class TestWhichTypesCanBeScoredAtAll:
    @pytest.mark.parametrize(
        "value_type",
        [
            ValueType.MONETARY,
            ValueType.QUANTITY,
            ValueType.COUNT,
            ValueType.RATIO,
            ValueType.INDEX,
            ValueType.ASSIGNED_SCORE,
        ],
    )
    def test_the_six_numeric_types_are_scoreable(self, value_type: ValueType) -> None:
        assert is_scoreable(value_type)

    @pytest.mark.parametrize(
        "value_type",
        [ValueType.LABEL_SET, ValueType.SHARE_COMPOSITION, ValueType.BOOLEAN, ValueType.TEXT],
    )
    def test_the_four_others_are_not(self, value_type: ValueType) -> None:
        """Asked before a value is read, so a criterion on a Text attribute is caught at
        configuration time rather than mid-ranking."""
        assert not is_scoreable(value_type)


class TestTheScaleAFigureWasPublishedOn:
    """`figure_of`, which was called by `ranking.py` and `comparisons.py` and by no test at all.

    **The gap survived the whole suite.** Reducing it to `return PublishedFigure(magnitude)` --
    dropping every published bound -- left 1,511 unit tests green and the suite at exit 0. That
    is the defect `known-issues` P49 records as having already shipped once: `as_is` reads an
    index on the scale its publisher declared, so with the bounds gone the World Bank's 0.72 on
    a -2.5 to 2.5 governance scale scores 0.72 out of 100 instead of 64. Ten shipped criteria
    turn on it.

    `magnitude_of` was thoroughly tested and so was `scores_for`; the seam between them was not,
    because `test_normalisation.py` builds every `PublishedFigure` by hand.
    """

    def test_an_index_carries_the_bounds_its_publisher_declared(self) -> None:
        value = a_value(
            value_type=ValueType.INDEX,
            payload=Index(
                value=Decimal("0.72"),
                provider="World Bank WGI",
                scale_min=Decimal("-2.5"),
                scale_max=Decimal("2.5"),
            ),
        )

        assert figure_of(value).published_bounds == (Decimal("-2.5"), Decimal("2.5"))

    def test_the_magnitude_is_the_published_figure_itself(self) -> None:
        """Carrying the bounds must not rescale the number; that is `scores_for`'s job."""
        value = a_value(
            value_type=ValueType.INDEX,
            payload=Index(
                value=Decimal("0.72"),
                provider="World Bank WGI",
                scale_min=Decimal("-2.5"),
                scale_max=Decimal("2.5"),
            ),
        )

        assert figure_of(value).magnitude == Decimal("0.72")

    def test_two_providers_of_one_attribute_keep_their_own_scales(self) -> None:
        """**Why the bounds travel with the figure rather than with the attribute.** Multi-source
        is the point of the design, and 71.4 on Numbeo's 0-100 is not 0.72 on the World Bank's
        -2.5 to 2.5. A bound read off the attribute would put one publisher's scale on the
        other's number, silently."""
        numbeo = a_value(
            value_type=ValueType.INDEX,
            payload=Index(
                value=Decimal("71.4"),
                provider="Numbeo",
                scale_min=Decimal(0),
                scale_max=Decimal(100),
            ),
        )
        world_bank = a_value(
            value_type=ValueType.INDEX,
            payload=Index(
                value=Decimal("0.72"),
                provider="World Bank WGI",
                scale_min=Decimal("-2.5"),
                scale_max=Decimal("2.5"),
            ),
        )

        assert figure_of(numbeo).published_bounds == (Decimal(0), Decimal(100))
        assert figure_of(world_bank).published_bounds == (Decimal("-2.5"), Decimal("2.5"))

    def test_an_assigned_score_carries_the_range_it_was_assigned_on(self) -> None:
        """PL-083 (UF-071). **A judgement means nothing without its scale**, exactly as an index
        does: the hand-entry form asks for the range because 7 on 0-10 and 7 on 0-100 are
        different judgements. The range reached storage and was dropped here, so 7 on 0-10
        scored 7 out of 100."""
        judged = AssignedScore(
            value=Decimal(7),
            range_min=Decimal(0),
            range_max=Decimal(10),
            assigned_by=Assigner.HUMAN,
        )

        figure = figure_of(a_value(value_type=ValueType.ASSIGNED_SCORE, payload=judged))

        assert (figure.magnitude, figure.published_bounds) == (7, (Decimal(0), Decimal(10)))

    @pytest.mark.parametrize(
        ("value_type", "payload"),
        [
            (ValueType.QUANTITY, Quantity(magnitude=Decimal("17.5"), unit="percent")),
            (ValueType.COUNT, Count(count=12, basis="airports")),
            (ValueType.MONETARY, Monetary.in_euro(Decimal("1410"))),
        ],
    )
    def test_nothing_else_claims_a_published_scale(
        self, value_type: ValueType, payload: object
    ) -> None:
        """**A measurement in a unit sits on no scale its type declares**, and inventing one for
        a Quantity would make `as_is` rescale a figure nobody put on a scale. An index, an
        assigned score and a share each declare theirs; rent, a count and a temperature do
        not."""
        value = a_value(value_type=value_type, payload=payload)

        assert figure_of(value).published_bounds is None

    def test_a_type_that_carries_no_figure_refuses_here_too(self) -> None:
        """The refusal belongs to `magnitude_of`, and `figure_of` must not swallow it."""
        value = a_value(
            value_type=ValueType.LABEL_SET,
            payload=LabelSet(labels=["Cfb"]),
        )

        with pytest.raises(UnscoreableValueError):
            figure_of(value)


AT_THE_MIDDLE_OF_ITS_SCALE: dict[ValueType, Payload] = {
    ValueType.INDEX: Index(
        value=Decimal(0),
        provider="World Bank WGI",
        scale_min=Decimal("-2.5"),
        scale_max=Decimal("2.5"),
    ),
    ValueType.ASSIGNED_SCORE: AssignedScore(
        value=Decimal(5),
        range_min=Decimal(0),
        range_max=Decimal(10),
        assigned_by=Assigner.HUMAN,
    ),
    ValueType.RATIO: Ratio(value=Decimal(50), basis="of land area"),
}
"""One figure half way up its own scale, for every type that declares one. No scale here is the
score scale the test reads it onto, so mapping is the only way to land on the middle of ours."""


def _declares_its_scale(payload_class: type[Payload]) -> bool:
    """Whether a payload type says what scale its figure is on, rather than inheriting None."""
    return payload_class.declared_scale is not Payload.declared_scale


def _scale_fields_of(payload_class: type[Payload]) -> set[str]:
    """Every `<stem>_min`/`<stem>_max` pair a payload type carries: a scale, by its shape."""
    fields = payload_class.model_fields
    return {
        name.removesuffix("_min")
        for name in fields
        if name.endswith("_min") and f"{name.removesuffix('_min')}_max" in fields
    }


def _criteria_permit_as_is(value_type: ValueType) -> bool:
    """Asked of `Criterion`, the authority on which methods a type may wear (`reqs.md` 3.3a)."""
    try:
        a_criterion(value_type=value_type, normalisation_method=NormalisationMethod.AS_IS)
    except ValidationError as refusal:
        if "does not permit" not in str(refusal):
            raise
        return False
    return True


class TestEveryDeclaredScaleTravels:
    """**A figure is read on the scale it declares, whatever its type** (PL-083, UF-071).

    The rule was written as an `Index` special case -- `isinstance(payload, Index)` -- because an
    assigned score was believed to be "a score already". It is a judgement on a scale its
    assigner states, and that scale reached storage and was dropped at scoring: 7 on 0-10 scored
    7 out of 100, and 700 on 0-1000 emptied the criterion for every candidate. The belief lived
    in docstrings and no test crossed the seam, so these hold the rule by type, not by example.
    """

    def test_every_payload_that_declares_a_scale_is_read_on_it(self) -> None:
        """G1a. A `<stem>_min`/`<stem>_max` pair is a scale the payload carries, and carrying
        one is not enough: `declared_scale` is the one place scoring looks for it."""
        carrying_a_scale = {
            value_type: payload_class
            for value_type, payload_class in PAYLOAD_CLASSES.items()
            if _scale_fields_of(payload_class)
        }
        assert carrying_a_scale, "no payload carries a scale, so this guard would pass vacuously"

        dropped = sorted(
            str(value_type)
            for value_type, payload_class in carrying_a_scale.items()
            if not _declares_its_scale(payload_class)
        )

        assert dropped == [], f"these carry a scale that scoring never reads: {dropped}"

    @pytest.mark.parametrize("value_type", list(AT_THE_MIDDLE_OF_ITS_SCALE))
    def test_the_middle_of_a_declared_scale_scores_the_middle_of_the_score_scale(
        self, value_type: ValueType
    ) -> None:
        """G1b. Half way up its own scale is half way up ours, through the two steps the ranking
        takes. A top of 150 rather than 100, so a figure scored raw, or mapped onto a hardcoded
        100, cannot land on 75 by accident."""
        payload = AT_THE_MIDDLE_OF_ITS_SCALE[value_type]
        figure = figure_of(a_value(value_type=value_type, payload=payload))

        scored = scores_for(
            [figure],
            method=NormalisationMethod.AS_IS,
            goal=Goal.MAXIMISE,
            score_scale_max=150,
        )

        assert scored == (75,)

    def test_every_type_that_declares_a_scale_is_scored_at_its_middle(self) -> None:
        """The guard above is only as wide as its table, so the table must name every type that
        declares a scale -- a new one cannot arrive unscored."""
        declaring = {
            value_type
            for value_type, payload_class in PAYLOAD_CLASSES.items()
            if _declares_its_scale(payload_class)
        }

        assert set(AT_THE_MIDDLE_OF_ITS_SCALE) == declaring

    def test_every_type_as_is_may_read_declares_its_scale(self) -> None:
        """G1c. `as_is` reads a figure as a position on its scale, so every type it may read has
        to declare one. Without it the bare magnitude is taken as the score -- which is how a
        homicide rate of 1.12 per 100,000 once scored 99 (`0442`)."""
        readable_as_is = {
            value_type
            for value_type in ValueType
            if is_scoreable(value_type) and _criteria_permit_as_is(value_type)
        }
        assert readable_as_is, "as_is reads no type at all, so this guard would pass vacuously"

        on_no_scale = sorted(
            str(value_type)
            for value_type in readable_as_is
            if not _declares_its_scale(PAYLOAD_CLASSES[value_type])
        )

        assert on_no_scale == [], f"as_is may read these, and they declare no scale: {on_no_scale}"


class TestWhatAThresholdReads:
    """C06-S1, N2: a threshold on an assigned score compares a percentage of the scale the score
    was given on, and every other figure in the attribute's own unit."""

    def test_an_assigned_score_is_read_as_a_percentage_of_its_own_scale(self) -> None:
        value = a_value(
            value_type=ValueType.ASSIGNED_SCORE,
            payload=AssignedScore(
                value=Decimal(7), range_min=Decimal(0), range_max=Decimal(10), assigned_by="human"
            ),
        )

        assert threshold_reading(value) == Decimal(70)

    def test_a_range_that_does_not_start_at_zero_is_read_from_its_bottom(self) -> None:
        value = a_value(
            value_type=ValueType.ASSIGNED_SCORE,
            payload=AssignedScore(
                value=Decimal(3), range_min=Decimal(1), range_max=Decimal(5), assigned_by="human"
            ),
        )

        assert threshold_reading(value) == Decimal(50)

    def test_an_index_keeps_its_publishers_unit(self) -> None:
        """Its unit is declared once for the attribute, so a threshold is written in it."""
        value = a_value(
            value_type=ValueType.INDEX, payload=AT_THE_MIDDLE_OF_ITS_SCALE[ValueType.INDEX]
        )

        assert threshold_reading(value) == Decimal(0)

    def test_any_other_figure_is_its_magnitude(self) -> None:
        assert threshold_reading(a_value(payload=Count(count=42))) == Decimal(42)

    def test_a_value_with_no_figure_has_no_reading(self) -> None:
        with pytest.raises(UnscoreableValueError):
            threshold_reading(a_value(value_type=ValueType.BOOLEAN, payload=Boolean(value=True)))
