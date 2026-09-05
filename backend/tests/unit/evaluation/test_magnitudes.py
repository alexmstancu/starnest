"""The one number a value contributes, and the values that contribute none.

Six of the ten value types carry a comparable figure. The other four are matched against
thresholds and never scored (`reqs.md` 3.3a), and the difference matters here because reading a
figure that does not exist is how a score gets fabricated.
"""

from datetime import date
from decimal import Decimal

import pytest

from starnest.data import (
    AssignedScore,
    Assigner,
    Boolean,
    Count,
    Index,
    LabelSet,
    Monetary,
    Quantity,
    Ratio,
    ValueType,
)
from starnest.evaluation import UnscoreableValueError, is_scoreable, magnitude_of

from .builders import a_value


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
