"""A catalog row: what it may declare, and when a figure offered to it is not credible.

Two distinctions are load-bearing here and both are tested directly. **Validation is not a
matching threshold** -- a rejected value is not believable, an unacceptable value is
believable and unwanted. And **a mismatched type is an error, not a rejection** -- there is
nothing to store and nothing to explain.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    AllowedRange,
    Attribute,
    AttributeDeclarationError,
    Boolean,
    Count,
    DataSource,
    IndexParameters,
    LabelSet,
    LifecycleStatus,
    Monetary,
    Pillar,
    Quantity,
    QuantityParameters,
    Ratio,
    RatioParameters,
    ReferencePeriod,
    SourceKind,
    SourcePriorityOverride,
    ValueType,
    ValueTypeMismatchError,
)

EUROSTAT = DataSource(
    id="eurostat",
    name="Eurostat",
    source_kind=SourceKind.STRUCTURED,
    default_priority=10,
    reliability_tier="official_international",
)
NUMBEO = DataSource(
    id="numbeo",
    name="Numbeo",
    source_kind=SourceKind.STRUCTURED,
    default_priority=60,
    reliability_tier="crowdsourced",
)


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": "country.avg_annual_temperature",
        "name": "Average annual temperature",
        "level": "country",
        "value_type": ValueType.QUANTITY,
        "pillar": "climate",
        "quantity_parameters": QuantityParameters(unit="celsius"),
    }
    return Attribute(**(fields | overrides))


class TestWhatACatalogRowHolds:
    def test_says_what_is_measured_and_how_fast_it_ages(self) -> None:
        attribute = an_attribute(max_age=timedelta(days=3650))
        assert attribute.value_type is ValueType.QUANTITY
        assert attribute.max_age == timedelta(days=3650)
        assert attribute.quantity_parameters is not None
        assert attribute.quantity_parameters.unit == "celsius"

    def test_says_nothing_about_whether_more_is_better(self) -> None:
        """The whole objective/subjective line, as a field list (`reqs.md` 3.0)."""
        forbidden = {"goal", "direction", "weight", "matching_threshold", "normalisation"}
        assert forbidden.isdisjoint(Attribute.model_fields)

    def test_an_attribute_with_no_pillar_is_descriptive_and_never_scored(self) -> None:
        assert an_attribute(pillar=None).is_scored is False
        assert an_attribute().is_scored is True

    def test_a_retired_attribute_keeps_its_row_and_leaves_scoring(self) -> None:
        retired = an_attribute(lifecycle_status=LifecycleStatus.RETIRED)
        assert retired.is_retired

    def test_a_broken_down_attribute_says_what_it_is_broken_down_by(self) -> None:
        """The name promises *what*, and the assertion only claimed *whether* (D16)."""
        broken_down = an_attribute(breakdown_scheme="bedroom_count")

        assert broken_down.is_broken_down
        assert broken_down.breakdown_scheme == "bedroom_count"
        assert not an_attribute().is_broken_down
        assert an_attribute().breakdown_scheme is None

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            an_attribute().max_age = timedelta(days=1)

    def test_a_pillar_is_a_vertical_with_no_level_of_its_own(self) -> None:
        """The same concerns apply at every level; only the weights differ (`reqs.md` 7)."""
        assert "level" not in Pillar.model_fields


class TestWhatACatalogRowRefuses:
    def test_refuses_an_identifier_from_another_level(self) -> None:
        with pytest.raises(ValidationError) as raised:
            an_attribute(id="city.avg_annual_temperature")
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], AttributeDeclarationError)

    def test_refuses_parameters_belonging_to_another_type(self) -> None:
        with pytest.raises(ValidationError):
            an_attribute(
                value_type=ValueType.RATIO,
                quantity_parameters=QuantityParameters(unit="celsius"),
                ratio_parameters=RatioParameters(basis="land_area"),
            )

    def test_refuses_allowed_labels_on_a_type_that_draws_from_no_vocabulary(self) -> None:
        with pytest.raises(ValidationError):
            an_attribute(allowed_labels=("csa", "cfb"))

    def test_refuses_an_allowed_range_on_a_type_with_no_number_in_it(self) -> None:
        with pytest.raises(ValidationError):
            an_attribute(
                value_type=ValueType.BOOLEAN,
                quantity_parameters=None,
                allowed_range=AllowedRange(min_value=Decimal("0")),
            )

    def test_refuses_a_max_age_of_zero_or_less(self) -> None:
        with pytest.raises(ValidationError):
            an_attribute(max_age=timedelta(0))

    def test_accepts_a_type_that_declares_no_parameters(self) -> None:
        """The seeded catalog has index attributes with no bounds, so this must stay legal."""
        assert (
            an_attribute(value_type=ValueType.INDEX, quantity_parameters=None).index_parameters
            is None
        )

    def test_refuses_an_index_scale_that_runs_backwards(self) -> None:
        with pytest.raises(ValidationError):
            IndexParameters(provider="Numbeo", scale_min=Decimal("100"), scale_max=Decimal("0"))


class TestAllowedRange:
    def test_refuses_a_range_that_bounds_nothing(self) -> None:
        with pytest.raises(ValidationError):
            AllowedRange()

    def test_refuses_a_range_that_runs_backwards(self) -> None:
        with pytest.raises(ValidationError):
            AllowedRange(min_value=Decimal("40"), max_value=Decimal("-20"))

    @pytest.mark.parametrize(
        ("number", "excluded"),
        [("-21", True), ("-20", False), ("0", False), ("40", False), ("41", True)],
    )
    def test_both_bounds_count_as_inside(self, number: str, excluded: bool) -> None:
        bounds = AllowedRange(min_value=Decimal("-20"), max_value=Decimal("40"))
        assert bounds.excludes(Decimal(number)) is excluded

    def test_an_open_ended_range_bounds_only_one_side(self) -> None:
        bounds = AllowedRange(min_value=Decimal("0"))
        assert bounds.excludes(Decimal("-1")) is True
        assert bounds.excludes(Decimal("1000000")) is False
        assert str(bounds) == "0 to any"


class TestRejectingAFigureThatIsNotCredible:
    def test_a_figure_inside_the_declared_range_is_accepted(self) -> None:
        attribute = an_attribute(
            allowed_range=AllowedRange(min_value=Decimal("-20"), max_value=Decimal("40"))
        )
        assert (
            attribute.rejection_reason_for(Quantity(magnitude=Decimal("12.4"), unit="celsius"))
            is None
        )

    def test_a_figure_outside_it_is_rejected_with_the_reason_in_words(self) -> None:
        attribute = an_attribute(
            allowed_range=AllowedRange(min_value=Decimal("-20"), max_value=Decimal("40"))
        )
        reason = attribute.rejection_reason_for(Quantity(magnitude=Decimal("212"), unit="celsius"))
        assert reason is not None
        assert "212" in reason and "-20 to 40" in reason

    def test_money_is_bounded_on_its_euro_equivalent(self) -> None:
        """A bound written against euro would otherwise reject every forint figure."""
        attribute = an_attribute(
            id="country.child_benefit",
            value_type=ValueType.MONETARY,
            quantity_parameters=None,
            allowed_range=AllowedRange(min_value=Decimal("0")),
        )
        assert attribute.rejection_reason_for(Monetary.in_euro(Decimal("120"))) is None
        assert attribute.rejection_reason_for(Monetary.in_euro(Decimal("-1"))) is not None

    @pytest.mark.parametrize(
        "payload",
        [
            Count(count=3),
            Ratio(value=Decimal("23"), basis="total_employment"),
        ],
    )
    def test_every_type_carrying_a_number_is_bounded_by_the_same_range(self, payload) -> None:
        attribute = an_attribute(
            id="country.counted",
            value_type=payload.value_type,
            quantity_parameters=None,
            allowed_range=AllowedRange(min_value=Decimal("100")),
        )
        assert attribute.rejection_reason_for(payload) is not None

    def test_a_type_carrying_no_number_is_never_rejected_by_a_range(self) -> None:
        attribute = an_attribute(
            id="country.coastal", value_type=ValueType.BOOLEAN, quantity_parameters=None
        )
        assert attribute.rejection_reason_for(Boolean(value=True)) is None

    def test_a_label_outside_the_declared_vocabulary_is_rejected(self) -> None:
        attribute = an_attribute(
            id="country.climate_zone",
            value_type=ValueType.LABEL_SET,
            quantity_parameters=None,
            allowed_labels=("csa", "cfb", "dfb"),
        )
        assert attribute.rejection_reason_for(LabelSet(labels=("csa",))) is None
        one = attribute.rejection_reason_for(LabelSet(labels=("csa", "tropical")))
        several = attribute.rejection_reason_for(LabelSet(labels=("tropical", "martian")))
        assert one is not None and "is not in the vocabulary" in one
        assert several is not None and "are not in the vocabulary" in several

    def test_an_attribute_declaring_no_vocabulary_accepts_any_label(self) -> None:
        attribute = an_attribute(
            id="country.tax_treaties", value_type=ValueType.LABEL_SET, quantity_parameters=None
        )
        assert attribute.rejection_reason_for(LabelSet(labels=("nl", "de"))) is None

    def test_a_payload_of_another_type_is_an_error_rather_than_a_rejection(self) -> None:
        """There is nothing to store: the database refuses the insert outright."""
        with pytest.raises(ValueTypeMismatchError):
            an_attribute().rejection_reason_for(Boolean(value=True))


class TestStalenessAndPriority:
    def test_asks_the_period_whether_it_has_aged_past_max_age(self) -> None:
        attribute = an_attribute(max_age=timedelta(days=365))
        assert attribute.has_gone_stale(ReferencePeriod.covering_year(2019), on=date(2026, 8, 19))
        assert not attribute.has_gone_stale(
            ReferencePeriod.covering_year(2026), on=date(2026, 8, 19)
        )

    def test_resolves_the_whole_source_order_including_what_it_does_not_override(self) -> None:
        attribute = an_attribute(
            source_priority_overrides=(SourcePriorityOverride(data_source="numbeo", rank=1),)
        )
        assert attribute.effective_source_priority((EUROSTAT, NUMBEO)).ordered == (
            "numbeo",
            "eurostat",
        )

    def test_an_attribute_overriding_nothing_inherits_the_global_order(self) -> None:
        assert an_attribute().effective_source_priority((NUMBEO, EUROSTAT)).ordered == (
            "eurostat",
            "numbeo",
        )


class TestIndexParametersDeclareTheScaleAnIndexIsPublishedOn:
    def test_holds_the_provider_and_the_bounds(self) -> None:
        """Which is what lets an index rescale with no anchors anyone has to invent."""
        parameters = IndexParameters(
            provider="World Bank WGI", scale_min=Decimal("-2.5"), scale_max=Decimal("2.5")
        )
        assert parameters.provider == "World Bank WGI"
        assert (parameters.scale_min, parameters.scale_max) == (Decimal("-2.5"), Decimal("2.5"))
