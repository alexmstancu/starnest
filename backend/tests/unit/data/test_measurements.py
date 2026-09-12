"""Building a value from what a source reported (`reqs.md` 3.6).

**The point of this class is one derivation nobody can restate wrongly.** Seven adapters built
a `Value` by hand and each wrote `value_type=attribute.value_type` itself. A value whose type is
not its attribute's is a payload the store cannot place -- the composite key in `value` refuses
it, at write time, after a run has reported success -- so the derivation happens in one place
now, and these tests are what hold it there.

**It builds; it does not validate.** `Value` keeps refusing what contradicts itself, which the
last test here proves rather than assumes: a builder that quietly widened what may be stored
would be worse than the seven copies it replaced.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    Count,
    Measurements,
    Quantity,
    QuantityParameters,
    Ratio,
    ReferencePeriod,
    ValueType,
)

COUNTRY = {"id": "country", "depth_order": 1}
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")
A_YEAR = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))
AN_INSTANT = datetime(2026, 9, 12, 8, 30, tzinfo=UTC)


def an_attribute(value_type: ValueType = ValueType.QUANTITY) -> Attribute:
    return Attribute(
        id="country.average_working_hours",
        name="Average working hours",
        level="country",
        value_type=value_type,
        pillar="career",
        quantity_parameters=(
            QuantityParameters(unit="hours_per_week") if value_type is ValueType.QUANTITY else None
        ),
    )


def measuring(**overrides: object) -> Measurements:
    fields: dict[str, object] = {
        "attribute": an_attribute(),
        "data_source": "eurostat",
        "retrieved": AN_INSTANT,
    }
    return Measurements(**(fields | overrides))  # type: ignore[arg-type]


def an_hours_figure() -> Quantity:
    return Quantity(magnitude=Decimal("38.7"), unit="hours_per_week")


def test_the_value_type_is_the_attributes_and_the_caller_never_says() -> None:
    """The derivation this class exists to make unrepeatable."""
    figure = measuring().figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)

    assert figure.value_type is ValueType.QUANTITY
    assert figure.attribute == "country.average_working_hours"


def test_every_figure_of_one_fetch_carries_the_same_retrieval_moment() -> None:
    """Thirty-two figures out of one request were retrieved at one instant. Stamping them a
    millisecond apart would invent a sequence that says something about nothing."""
    fetch = measuring()

    first = fetch.figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)
    second = fetch.figure(candidate=SPAIN, payload=an_hours_figure(), period=A_YEAR)

    assert first.retrieval_date == second.retrieval_date == AN_INSTANT


def test_the_source_is_the_fetchs_and_reaches_the_value() -> None:
    figure = measuring(data_source="world_bank").figure(
        candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR
    )

    assert figure.data_source == "world_bank"


def test_confidence_defaults_to_the_fetchs_and_a_figure_may_say_otherwise() -> None:
    """Eurostat flags individual observations as provisional, so two countries in one response
    can be worth different amounts -- while the IMF's whole forecast is `medium` at once."""
    fetch = measuring(confidence_level=ConfidenceLevel.HIGH)

    ordinary = fetch.figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)
    provisional = fetch.figure(
        candidate=SPAIN,
        payload=an_hours_figure(),
        period=A_YEAR,
        confidence_level=ConfidenceLevel.MEDIUM,
    )

    assert ordinary.confidence_level is ConfidenceLevel.HIGH
    assert provisional.confidence_level is ConfidenceLevel.MEDIUM


def test_a_candidate_may_be_given_as_a_record_or_as_an_identifier() -> None:
    """An adapter holds the record; a stand-in holds only the id."""
    from_record = measuring().figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)
    from_identifier = measuring().figure(
        candidate="country.portugal", payload=an_hours_figure(), period=A_YEAR
    )

    assert from_record.candidate == from_identifier.candidate == "country.portugal"


def test_the_words_a_figure_was_read_from_are_carried_through() -> None:
    figure = measuring().figure(
        candidate=PORTUGAL,
        payload=an_hours_figure(),
        period=A_YEAR,
        quote="Eurostat lfsa_ewhun2 2025: 38.7",
        citations=["https://ec.europa.eu/eurostat/databrowser/view/lfsa_ewhun2"],
    )

    assert figure.quote == "Eurostat lfsa_ewhun2 2025: 38.7"
    assert figure.citations == ("https://ec.europa.eu/eurostat/databrowser/view/lfsa_ewhun2",)


def test_a_figure_names_no_breakdown_unless_it_is_one() -> None:
    plain = measuring().figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)

    assert plain.breakdown_option is None


def test_the_two_dates_stay_two_dates() -> None:
    """The period is what the figure describes; the retrieval date is when we fetched it, and
    the two are never merged (`reqs.md` 3.6)."""
    figure = measuring().figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)

    assert figure.reference_period == A_YEAR
    assert figure.retrieval_date == AN_INSTANT


def test_it_does_not_weaken_what_a_value_refuses() -> None:
    """A payload of the wrong shape for the attribute is still refused, by `Value` itself.

    Without this the builder could have become a way around the validation it sits in front of,
    which would be worse than the seven hand-written constructors it replaced.
    """
    counting = measuring(attribute=an_attribute(ValueType.COUNT))

    with pytest.raises(ValueError):
        counting.figure(candidate=PORTUGAL, payload=an_hours_figure(), period=A_YEAR)


def test_a_payload_of_the_declared_type_is_accepted() -> None:
    """The control for the refusal above: same builder, right payload."""
    counting = measuring(attribute=an_attribute(ValueType.COUNT))

    figure = counting.figure(
        candidate=PORTUGAL, payload=Count(count=1420, basis="per_capita"), period=A_YEAR
    )

    assert figure.value_type is ValueType.COUNT


def test_a_ratio_where_a_quantity_was_declared_is_refused() -> None:
    """The same guard from the other direction, because `Ratio` and `Quantity` are the pair an
    adapter is most likely to confuse."""
    with pytest.raises(ValueError):
        measuring().figure(
            candidate=PORTUGAL,
            payload=Ratio(value=Decimal("7.5"), basis="households"),
            period=A_YEAR,
        )
