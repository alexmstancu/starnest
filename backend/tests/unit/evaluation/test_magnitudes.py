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
from starnest.evaluation import (
    UnscoreableValueError,
    figure_of,
    is_scoreable,
    magnitude_of,
)

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

    @pytest.mark.parametrize(
        ("value_type", "payload"),
        [
            (ValueType.QUANTITY, Quantity(magnitude=Decimal("17.5"), unit="percent")),
            (ValueType.COUNT, Count(count=12, basis="airports")),
            (ValueType.RATIO, Ratio(value=Decimal("31.2"), basis="of land area")),
        ],
    )
    def test_nothing_else_claims_a_published_scale(
        self, value_type: ValueType, payload: object
    ) -> None:
        """**Only an `Index` declares bounds**, and inventing them for a Quantity would make
        `as_is` rescale a figure nobody put on a scale."""
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
