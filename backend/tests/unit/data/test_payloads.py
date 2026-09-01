"""The ten value types: what each one holds, and what each one refuses.

Table-driven on purpose. The ten types are a closed set the schema also enumerates, and the
failure this file exists to catch is a type whose rules were never exercised at all -- which a
table makes visible and a hand-written test per type does not.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from starnest.data import (
    EURO,
    AssignedScore,
    Assigner,
    Boolean,
    Count,
    CurrencyMismatchError,
    FxRate,
    Index,
    LabelSet,
    MalformedPayloadError,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    Share,
    ShareComposition,
    Text,
    ValuePayload,
    ValueType,
    payload_class_for,
)
from starnest.data.payloads import PAYLOAD_CLASSES

WELL_FORMED: dict[ValueType, dict[str, Any]] = {
    ValueType.MONETARY: {
        "amount": Decimal("1410"),
        "currency": "EUR",
        "amount_eur": Decimal("1410"),
    },
    ValueType.QUANTITY: {"magnitude": Decimal("12.4"), "unit": "celsius"},
    ValueType.COUNT: {"count": 47, "basis": "per_capita"},
    ValueType.RATIO: {"value": Decimal("23.4"), "basis": "total_employment"},
    ValueType.INDEX: {
        "value": Decimal("0.72"),
        "provider": "World Bank WGI",
        "scale_min": Decimal("-2.5"),
        "scale_max": Decimal("2.5"),
    },
    ValueType.LABEL_SET: {"labels": ("csa", "cfb")},
    ValueType.SHARE_COMPOSITION: {
        "shares": (
            {"label": "catholic", "share": Decimal("79")},
            {"label": "none", "share": Decimal("14")},
            {"label": "other", "share": Decimal("7")},
        )
    },
    ValueType.BOOLEAN: {"value": True},
    ValueType.ASSIGNED_SCORE: {
        "value": Decimal("7"),
        "range_min": Decimal("0"),
        "range_max": Decimal("10"),
        "assigned_by": "llm",
    },
    ValueType.TEXT: {"body": "Residence permits are issued by the immigration service."},
}

ALL_TYPES = list(ValueType)


def a_payload(value_type: ValueType) -> Payload:
    return payload_class_for(value_type)(**WELL_FORMED[value_type])


class TestTheTenTypesAsASet:
    def test_every_type_has_a_class(self) -> None:
        """A type with no class would be a value type nothing could store."""
        assert set(PAYLOAD_CLASSES) == set(ValueType)

    def test_there_are_exactly_ten(self) -> None:
        """`reqs.md` 3.3a. Adding an eleventh is a code change and should be a visible one."""
        assert len(ValueType) == 10

    @pytest.mark.parametrize("value_type", ALL_TYPES)
    def test_the_type_names_are_the_ones_the_schema_stores(self, value_type: ValueType) -> None:
        assert (
            value_type.value
            == payload_class_for(value_type.value)(**WELL_FORMED[value_type]).value_type
        )

    @pytest.mark.parametrize("value_type", ALL_TYPES)
    def test_each_type_round_trips_through_its_own_class(self, value_type: ValueType) -> None:
        payload = a_payload(value_type)
        restored = payload_class_for(value_type).model_validate(payload.model_dump())
        assert restored == payload

    @pytest.mark.parametrize("value_type", ALL_TYPES)
    def test_each_payload_tags_itself_so_the_union_can_be_parsed(
        self, value_type: ValueType
    ) -> None:
        """The tag is the schema's `CHECK (value_type = ...)` written in Python."""
        parsed = TypeAdapter(ValuePayload).validate_python(a_payload(value_type).model_dump())
        assert type(parsed) is PAYLOAD_CLASSES[value_type]

    @pytest.mark.parametrize("value_type", ALL_TYPES)
    def test_each_payload_is_immutable(self, value_type: ValueType) -> None:
        with pytest.raises(ValidationError):
            a_payload(value_type).value_type = ValueType.TEXT

    @pytest.mark.parametrize("value_type", ALL_TYPES)
    def test_no_payload_accepts_a_field_of_another_type(self, value_type: ValueType) -> None:
        with pytest.raises(ValidationError):
            payload_class_for(value_type)(**WELL_FORMED[value_type], currency_of_the_month="EUR")

    def test_an_untagged_payload_cannot_be_parsed_as_the_union(self) -> None:
        untagged = dict(WELL_FORMED[ValueType.QUANTITY])
        with pytest.raises(ValidationError):
            TypeAdapter(ValuePayload).validate_python(untagged)

    def test_asking_for_a_type_that_does_not_exist_says_which_ten_do(self) -> None:
        with pytest.raises(MalformedPayloadError) as raised:
            payload_class_for("Currency")
        assert "Monetary" in str(raised.value)


REFUSED: list[tuple[str, type[Payload], dict[str, Any]]] = [
    # Monetary
    (
        "money with no currency",
        Monetary,
        {"amount": Decimal("1410"), "amount_eur": Decimal("1410")},
    ),
    (
        "money with a currency that is not ISO 4217",
        Monetary,
        {"amount": Decimal("1"), "currency": "euro", "amount_eur": Decimal("1")},
    ),
    (
        "a foreign amount with no rate to explain the conversion",
        Monetary,
        {"amount": Decimal("2900"), "currency": "CHF", "amount_eur": Decimal("3045")},
    ),
    (
        "a rate with no date",
        Monetary,
        {
            "amount": Decimal("2900"),
            "currency": "CHF",
            "amount_eur": Decimal("3045"),
            "fx_rate": Decimal("1.05"),
        },
    ),
    (
        "a date with no rate",
        Monetary,
        {
            "amount": Decimal("1"),
            "currency": "EUR",
            "amount_eur": Decimal("1"),
            "fx_rate_date": date(2026, 7, 1),
        },
    ),
    (
        "an amount that is not a number",
        Monetary,
        {"amount": Decimal("NaN"), "currency": "EUR", "amount_eur": Decimal("NaN")},
    ),
    (
        "a rate of zero",
        Monetary,
        {
            "amount": Decimal("1"),
            "currency": "CHF",
            "amount_eur": Decimal("1"),
            "fx_rate": Decimal("0"),
            "fx_rate_date": date(2026, 7, 1),
        },
    ),
    # Quantity
    ("a magnitude with no unit", Quantity, {"magnitude": Decimal("12.4")}),
    (
        "a unit that is not an identifier",
        Quantity,
        {"magnitude": Decimal("12.4"), "unit": "Celsius"},
    ),
    # Count
    ("minus three national parks", Count, {"count": -3}),
    ("a fractional count", Count, {"count": 4.5}),
    # Ratio
    ("a share above 100", Ratio, {"value": Decimal("101"), "basis": "land_area"}),
    ("a negative share", Ratio, {"value": Decimal("-1"), "basis": "land_area"}),
    ("a share of nothing in particular", Ratio, {"value": Decimal("23")}),
    ("a share whose basis is blank", Ratio, {"value": Decimal("23"), "basis": ""}),
    # Index
    (
        "an index above the scale it declares",
        Index,
        {
            "value": Decimal("3"),
            "provider": "WGI",
            "scale_min": Decimal("-2.5"),
            "scale_max": Decimal("2.5"),
        },
    ),
    (
        "an index below the scale it declares",
        Index,
        {
            "value": Decimal("-3"),
            "provider": "WGI",
            "scale_min": Decimal("-2.5"),
            "scale_max": Decimal("2.5"),
        },
    ),
    (
        "a scale that runs backwards",
        Index,
        {
            "value": Decimal("50"),
            "provider": "Numbeo",
            "scale_min": Decimal("100"),
            "scale_max": Decimal("0"),
        },
    ),
    (
        "an index with no provider",
        Index,
        {
            "value": Decimal("50"),
            "provider": "",
            "scale_min": Decimal("0"),
            "scale_max": Decimal("100"),
        },
    ),
    # LabelSet
    ("an empty label set", LabelSet, {"labels": ()}),
    ("a blank label", LabelSet, {"labels": ("csa", "  ")}),
    ("the same label twice", LabelSet, {"labels": ("csa", "csa")}),
    # ShareComposition
    (
        "shares that do not sum to 100",
        ShareComposition,
        {
            "shares": (
                {"label": "catholic", "share": Decimal("79")},
                {"label": "none", "share": Decimal("14")},
            )
        },
    ),
    (
        "shares that sum to more than 100",
        ShareComposition,
        {
            "shares": (
                {"label": "a", "share": Decimal("70")},
                {"label": "b", "share": Decimal("40")},
            )
        },
    ),
    ("a composition of nothing", ShareComposition, {"shares": ()}),
    (
        "the same category twice",
        ShareComposition,
        {
            "shares": (
                {"label": "a", "share": Decimal("50")},
                {"label": "a", "share": Decimal("50")},
            )
        },
    ),
    (
        "a negative share",
        ShareComposition,
        {
            "shares": (
                {"label": "a", "share": Decimal("-10")},
                {"label": "b", "share": Decimal("110")},
            )
        },
    ),
    # Boolean
    ("a boolean that is neither", Boolean, {"value": "maybe"}),
    # AssignedScore
    (
        "a score above the range it was assigned on",
        AssignedScore,
        {
            "value": Decimal("11"),
            "range_min": Decimal("0"),
            "range_max": Decimal("10"),
            "assigned_by": "llm",
        },
    ),
    (
        "a range that runs backwards",
        AssignedScore,
        {
            "value": Decimal("5"),
            "range_min": Decimal("10"),
            "range_max": Decimal("0"),
            "assigned_by": "llm",
        },
    ),
    (
        "a score nobody will admit to",
        AssignedScore,
        {"value": Decimal("5"), "range_min": Decimal("0"), "range_max": Decimal("10")},
    ),
    (
        "a score assigned by something that is neither model nor person",
        AssignedScore,
        {
            "value": Decimal("5"),
            "range_min": Decimal("0"),
            "range_max": Decimal("10"),
            "assigned_by": "numbeo",
        },
    ),
    # Text
    ("text with nothing in it", Text, {"body": ""}),
    ("text that is only whitespace", Text, {"body": "   \n "}),
]


class TestWhatEachTypeRefuses:
    @pytest.mark.parametrize(
        ("payload_class", "fields"),
        [pytest.param(cls, fields, id=name) for name, cls, fields in REFUSED],
    )
    def test_refuses(self, payload_class: type[Payload], fields: dict[str, Any]) -> None:
        with pytest.raises(ValidationError):
            payload_class(**fields)


class TestMoneyAndItsConversion:
    def test_a_figure_published_in_euro_needs_no_rate(self) -> None:
        money = Monetary.in_euro(Decimal("1410"))
        assert money.is_native_euro
        assert money.amount == money.amount_eur == 1410
        assert money.fx_rate is None and money.fx_rate_date is None

    def test_a_converted_figure_keeps_the_published_amount_and_the_rate_beside_it(self) -> None:
        """`reqs.md` 5.5: the published figure is retained exactly as issued."""
        rate = FxRate(
            base_currency="CHF",
            quote_currency=EURO,
            rate_date=date(2026, 7, 1),
            rate=Decimal("1.05"),
            data_source="ecb",
        )
        money = Monetary.converted(Decimal("2900"), rate=rate)
        assert (money.amount, money.currency) == (Decimal("2900"), "CHF")
        assert money.amount_eur == Decimal("3045.00")
        assert (money.fx_rate, money.fx_rate_date) == (Decimal("1.05"), date(2026, 7, 1))
        assert not money.is_native_euro

    def test_refuses_a_rate_that_does_not_quote_euro(self) -> None:
        rate = FxRate(
            base_currency="CHF",
            quote_currency="GBP",
            rate_date=date(2026, 7, 1),
            rate=Decimal("0.9"),
            data_source="ecb",
        )
        with pytest.raises(CurrencyMismatchError):
            Monetary.converted(Decimal("2900"), rate=rate)

    def test_a_negative_amount_is_legal_because_a_balance_may_be_negative(self) -> None:
        """Non-negativity is an attribute's rule, never the type's (`reqs.md` 3.3a)."""
        assert Monetary.in_euro(Decimal("-250")).amount == -250


class TestShareCompositionTolerance:
    @pytest.mark.parametrize("last_share", ["6.6", "7.4"])
    def test_accepts_rounding_drift_around_100(self, last_share: str) -> None:
        composition = ShareComposition(
            shares=(
                Share(label="catholic", share=Decimal("79")),
                Share(label="none", share=Decimal("14")),
                Share(label="other", share=Decimal(last_share)),
            )
        )
        assert len(composition.shares) == 3

    def test_refuses_drift_wide_enough_to_be_a_missing_category(self) -> None:
        with pytest.raises(ValidationError):
            ShareComposition(
                shares=(
                    Share(label="catholic", share=Decimal("79")),
                    Share(label="none", share=Decimal("14")),
                    Share(label="other", share=Decimal("5")),
                )
            )


class TestNothingHereKnowsWhatGoodMeans:
    def test_a_boolean_carries_no_opinion_about_which_answer_is_better(self) -> None:
        assert set(Boolean(value=True).model_dump()) == {"value_type", "value"}

    def test_an_assigned_score_records_who_assigned_it(self) -> None:
        score = AssignedScore(
            value=Decimal("7"),
            range_min=Decimal("0"),
            range_max=Decimal("10"),
            assigned_by=Assigner.LLM,
            rationale="Extrapolated from three national sources.",
        )
        assert score.assigned_by is Assigner.LLM
