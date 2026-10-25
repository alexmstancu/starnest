"""A value typed by hand, and the permission it needs (`reqs.md` 6.5)."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from starnest.data import (
    MANUAL,
    Attribute,
    ConfidenceLevel,
    DataSource,
    InvalidManualValueError,
    LifecycleStatus,
    ManualEntryNotPermittedError,
    ManualEntrySwitchedOffError,
    Quantity,
    QuantityParameters,
    ReferencePeriod,
    SourceKind,
    ValueType,
    a_manual_value,
)

YEARS = {"magnitude": 5, "unit": "years"}


def manual_source(*, is_enabled: bool = True) -> DataSource:
    return DataSource(
        id="manual",
        name="Manual entry",
        source_kind=SourceKind.MANUAL,
        default_priority=90,
        reliability_tier="manual",
        is_enabled=is_enabled,
    )


SWITCHED_OFF = (manual_source(is_enabled=False),)


def naturalisation(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": "country.naturalisation_pathway",
        "name": "Naturalisation pathway",
        "level": "country",
        "value_type": ValueType.QUANTITY,
        "pillar": "governance",
        "quantity_parameters": QuantityParameters(unit="years"),
        "manual_entry": True,
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def typed(attribute: Attribute, payload: dict = YEARS, **overrides: object):
    return a_manual_value(
        attribute,
        **({"sources": (manual_source(),)} | overrides),  # type: ignore[arg-type]
        candidate="country.portugal",
        payload=payload,
        reference_period=ReferencePeriod.covering_year(2026),
        retrieval_date=datetime(2026, 9, 11, tzinfo=UTC),
    )


def test_it_is_a_manual_value_of_the_attributes_own_type() -> None:
    value = typed(naturalisation())

    assert value.data_source == MANUAL
    assert value.payload == Quantity(magnitude=Decimal(5), unit="years")


def test_the_default_confidence_is_the_unflattering_middle() -> None:
    assert typed(naturalisation()).confidence_level is ConfidenceLevel.MEDIUM


def test_a_researched_value_may_say_it_is_better_than_that() -> None:
    assert typed(naturalisation(), confidence_level=ConfidenceLevel.HIGH).confidence_level is (
        ConfidenceLevel.HIGH
    )


def test_an_attribute_that_has_not_declared_it_refuses() -> None:
    with pytest.raises(ManualEntryNotPermittedError, match="does not permit manual entry"):
        typed(naturalisation(manual_entry=False))


def test_a_switched_off_manual_source_refuses() -> None:
    """Scoring leaves a switched-off source out (Q232), so a figure stored then could not count
    (PL-089)."""
    with pytest.raises(ManualEntrySwitchedOffError, match="switched off"):
        typed(naturalisation(), sources=SWITCHED_OFF)


def test_an_attribute_that_never_takes_one_is_named_before_the_switch() -> None:
    """A catalog fact nobody can change outranks a switch somebody can flip."""
    with pytest.raises(ManualEntryNotPermittedError):
        typed(naturalisation(manual_entry=False), sources=SWITCHED_OFF)


def test_a_retired_attribute_is_named_before_the_switch() -> None:
    with pytest.raises(InvalidManualValueError, match="retired"):
        typed(naturalisation(lifecycle_status=LifecycleStatus.RETIRED), sources=SWITCHED_OFF)


def test_the_switch_is_named_before_what_was_typed() -> None:
    with pytest.raises(ManualEntrySwitchedOffError):
        typed(naturalisation(), {"labels": ["five years"]}, sources=SWITCHED_OFF)


def test_other_sources_switched_off_do_not_refuse_it() -> None:
    eurostat = manual_source(is_enabled=False).model_copy(
        update={"id": "eurostat", "source_kind": SourceKind.STRUCTURED}
    )
    assert typed(naturalisation(), sources=(eurostat, manual_source())).data_source == MANUAL


def test_a_retired_attribute_takes_no_new_values() -> None:
    with pytest.raises(InvalidManualValueError, match="retired"):
        typed(naturalisation(lifecycle_status=LifecycleStatus.RETIRED))


def test_a_payload_cannot_claim_another_type_by_labelling_itself() -> None:
    """The shape follows from the attribute: a Ratio's fields typed into a Quantity attribute
    are refused, whatever the request calls them."""
    with pytest.raises(InvalidManualValueError, match="is a Quantity"):
        typed(naturalisation(), {"value": 5, "basis": "households", "value_type": "Ratio"})


def test_a_hand_typed_quantity_in_the_wrong_unit_is_stored_with_its_reason() -> None:
    """The exact BE-06 case: a human types 5 for a years attribute but leaves the unit on
    celsius. It is a well-formed Quantity, so it is not refused -- it is kept, with the reason
    beside it, and the active-value rule passes over anything carrying one, so it never scores
    5 degrees as 5 years."""
    value = typed(naturalisation(), {"magnitude": 5, "unit": "celsius"})

    assert value.payload == Quantity(magnitude=Decimal(5), unit="celsius")
    assert value.rejection_reason is not None
    assert "celsius" in value.rejection_reason and "years" in value.rejection_reason
