"""`ValueStore` against the real append-only table and the real `active_value` view.

Two things are proven here that a fake could not prove. The first is that **the ten payload
shapes survive the round trip through jsonb unchanged**, decimals included -- a figure that
comes back as a float is money that no longer adds up. The second is that **the schema refuses
what the domain refuses**: a payload of the wrong type is rejected by the composite foreign
key of `arch.md` 3.3b, from the other side, with no Python check involved.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import (
    AssignedScore,
    Assigner,
    Boolean,
    ConfidenceLevel,
    Count,
    ExternalScore,
    Index,
    LabelSet,
    MalformedValueError,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    ReferencePeriod,
    Share,
    ShareComposition,
    Text,
    Value,
    ValueType,
)
from starnest.storage import PostgresValueStore

pytestmark = pytest.mark.storage

A_CANDIDATE = "country.portugal"
ANOTHER_CANDIDATE = "country.romania"
A_PERIOD = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))
RETRIEVED = datetime(2026, 7, 1, 9, 30, tzinfo=UTC)

A_MONETARY_ATTRIBUTE = "country.child_benefit_policy"
A_QUANTITY_ATTRIBUTE = "country.average_working_hours"
A_COUNT_ATTRIBUTE = "country.tech_software_jobs"
A_RATIO_ATTRIBUTE = "country.tech_employment_share"
AN_INDEX_ATTRIBUTE = "country.english_proficiency"
A_LABEL_SET_ATTRIBUTE = "country.climate_zone"
AN_ASSIGNED_SCORE_ATTRIBUTE = "country.pension_portability"

A_BETTER_SOURCE = "eurostat"
A_WORSE_SOURCE = "numbeo"


@pytest.fixture
def values(pool: AsyncConnectionPool) -> PostgresValueStore:
    return PostgresValueStore(pool)


def a_value(
    *,
    attribute: str,
    payload: Payload | None,
    value_type: ValueType | None = None,
    candidate: str = A_CANDIDATE,
    data_source: str = A_BETTER_SOURCE,
    rejection_reason: str | None = None,
    citations: tuple[str, ...] = (),
    quote: str | None = None,
    retrieved: datetime = RETRIEVED,
) -> Value:
    """One value with the provenance every value carries, and nothing incidental."""
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=value_type or (payload.value_type if payload else ValueType.COUNT),
        data_source=data_source,
        reference_period=A_PERIOD,
        retrieval_date=retrieved,
        confidence_level=ConfidenceLevel.HIGH,
        payload=payload,
        rejection_reason=rejection_reason,
        citations=citations,
        quote=quote,
    )


# --- the ten payload shapes ---------------------------------------------------------------

SEEDED_PAYLOADS = [
    (A_MONETARY_ATTRIBUTE, Monetary.in_euro(Decimal("184.35"))),
    (A_QUANTITY_ATTRIBUTE, Quantity(magnitude=Decimal("38.7"), unit="hours_per_week")),
    (A_COUNT_ATTRIBUTE, Count(count=1420, basis="per_capita")),
    (A_RATIO_ATTRIBUTE, Ratio(value=Decimal("4.85"), basis="total_employment")),
    (
        AN_INDEX_ATTRIBUTE,
        Index(
            value=Decimal("571.4"), provider="EF EPI", scale_min=Decimal(0), scale_max=Decimal(800)
        ),
    ),
    (A_LABEL_SET_ATTRIBUTE, LabelSet(labels=("Csa", "Csb"))),
    (
        AN_ASSIGNED_SCORE_ATTRIBUTE,
        AssignedScore(
            value=Decimal("7"),
            range_min=Decimal(0),
            range_max=Decimal(10),
            assigned_by=Assigner.HUMAN,
            rationale="bilateral agreement in force",
        ),
    ),
]

UNSEEDED_PAYLOADS = [
    ("country.dual_citizenship_permitted", Boolean(value=True)),
    (
        "country.religious_composition",
        ShareComposition(
            shares=(
                Share(label="catholic", share=Decimal("80.2")),
                Share(label="none", share=Decimal("19.8")),
            )
        ),
    ),
    ("country.residency_procedure", Text(body="Apply at the consulate before arrival.")),
]


@pytest.mark.parametrize(
    "attribute,payload", SEEDED_PAYLOADS, ids=[str(p.value_type) for _, p in SEEDED_PAYLOADS]
)
async def test_a_payload_survives_the_round_trip_unchanged(
    values: PostgresValueStore, attribute: str, payload: Payload
) -> None:
    """Same class, same fields, same decimals -- through ten tables and back through jsonb."""
    await values.append([a_value(attribute=attribute, payload=payload)])

    (stored,) = await values.read_active_values(attributes=[attribute])

    assert stored.payload == payload


@pytest.mark.parametrize(
    "attribute,payload", UNSEEDED_PAYLOADS, ids=[str(p.value_type) for _, p in UNSEEDED_PAYLOADS]
)
async def test_a_payload_of_a_type_the_mvp_catalog_has_no_attribute_for_also_survives(
    values: PostgresValueStore,
    add_attribute: Callable[..., Any],
    attribute: str,
    payload: Payload,
) -> None:
    """Boolean, ShareComposition and Text arrive with the city level, and already work."""
    await add_attribute(attribute, str(payload.value_type))

    await values.append([a_value(attribute=attribute, payload=payload)])
    (stored,) = await values.read_active_values(attributes=[attribute])

    assert stored.payload == payload


async def test_a_converted_amount_keeps_the_rate_and_the_day_it_was_converted_on(
    values: PostgresValueStore,
) -> None:
    """A EUR figure nobody can reproduce is not a figure (`reqs.md` 5.5)."""
    payload = Monetary(
        amount=Decimal("910.00"),
        currency="RON",
        amount_eur=Decimal("182.94"),
        fx_rate=Decimal("0.201033"),
        fx_rate_date=date(2026, 6, 30),
    )

    await values.append([a_value(attribute=A_MONETARY_ATTRIBUTE, payload=payload)])
    (stored,) = await values.read_active_values(attributes=[A_MONETARY_ATTRIBUTE])

    assert stored.payload == payload
    assert stored.payload.fx_rate == Decimal("0.201033")


# --- appending ----------------------------------------------------------------------------


async def test_appending_returns_the_value_carrying_the_identifier_it_was_given(
    values: PostgresValueStore,
) -> None:
    (appended,) = await values.append(
        [a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=3))]
    )

    assert appended.id is not None
    (stored,) = await values.read_active_values(attributes=[A_COUNT_ATTRIBUTE])
    assert stored.id == appended.id


async def test_the_two_dates_stay_two_dates(values: PostgresValueStore) -> None:
    """The span in the world and the instant it was fetched, never merged (`reqs.md` 3.6)."""
    await values.append([a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=3))])

    (stored,) = await values.read_active_values(attributes=[A_COUNT_ATTRIBUTE])

    assert stored.reference_period == A_PERIOD
    assert stored.retrieval_date == RETRIEVED
    assert stored.retrieval_date.tzinfo is not None


async def test_the_pages_behind_a_figure_come_back_with_it(values: PostgresValueStore) -> None:
    citations = ("https://example.org/a", "https://example.org/b")

    await values.append(
        [a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=3), citations=citations)]
    )

    (stored,) = await values.read_values(attribute=A_COUNT_ATTRIBUTE)
    assert stored.citations == citations


async def test_appending_nothing_stores_nothing_and_returns_nothing(
    values: PostgresValueStore,
) -> None:
    assert await values.append([]) == ()
    assert await values.count_values() == 0


# --- rejection ----------------------------------------------------------------------------


async def test_a_rejected_figure_is_stored_with_its_reason_and_never_becomes_active(
    values: PostgresValueStore,
) -> None:
    """Nothing is discarded. The row stays visible and the view skips it (`arch.md` 4)."""
    await values.append(
        [
            a_value(
                attribute=A_COUNT_ATTRIBUTE,
                payload=None,
                value_type=ValueType.COUNT,
                rejection_reason="the source returned a negative count",
            )
        ]
    )

    assert await values.read_active_values(attributes=[A_COUNT_ATTRIBUTE]) == ()
    (stored,) = await values.read_values(attribute=A_COUNT_ATTRIBUTE)
    assert stored.is_rejected
    assert stored.payload is None


async def test_a_figure_rejected_for_being_outside_its_credible_range_keeps_its_payload(
    values: PostgresValueStore,
) -> None:
    """Two rejections, two shapes: one has nothing storable, this one has a figure to show."""
    payload = Count(count=99_999_999)

    await values.append(
        [
            a_value(
                attribute=A_COUNT_ATTRIBUTE,
                payload=payload,
                rejection_reason="outside the credible range",
            )
        ]
    )

    (stored,) = await values.read_values(attribute=A_COUNT_ATTRIBUTE)
    assert stored.payload == payload
    assert stored.is_rejected


async def test_a_payload_of_another_type_is_refused_by_the_domain() -> None:
    with pytest.raises(ValueError) as refused:
        a_value(
            attribute=A_COUNT_ATTRIBUTE,
            payload=Count(count=3),
            value_type=ValueType.MONETARY,
        )

    assert isinstance(refused.value.errors()[0]["ctx"]["error"], MalformedValueError)


async def test_a_payload_of_another_type_is_refused_by_the_schema_as_well(
    values: PostgresValueStore,
) -> None:
    """The type-agreement chain from the other end, with no Python check in the way.

    The domain object is built without validation on purpose: what is under test is that the
    composite foreign key of `arch.md` 3.3b would catch this even if nothing else did.
    """
    contradictory = Value.model_construct(
        candidate=A_CANDIDATE,
        attribute=A_COUNT_ATTRIBUTE,
        value_type=ValueType.COUNT,
        data_source=A_BETTER_SOURCE,
        reference_period=A_PERIOD,
        retrieval_date=RETRIEVED,
        confidence_level=ConfidenceLevel.HIGH,
        payload=Quantity(magnitude=Decimal("1"), unit="hours_per_week"),
    )

    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        await values.append([contradictory])


# --- what is active, and what is merely stored ---------------------------------------------


async def test_the_better_source_is_active_and_the_other_one_is_still_there(
    values: PostgresValueStore,
) -> None:
    """Multi-source and non-destructive: selecting an active value discards nothing."""
    await values.append(
        [
            a_value(
                attribute=A_COUNT_ATTRIBUTE, payload=Count(count=100), data_source=A_WORSE_SOURCE
            ),
            a_value(
                attribute=A_COUNT_ATTRIBUTE, payload=Count(count=200), data_source=A_BETTER_SOURCE
            ),
        ]
    )

    (active,) = await values.read_active_values(attributes=[A_COUNT_ATTRIBUTE])
    stored = await values.read_values(attribute=A_COUNT_ATTRIBUTE)

    assert active.data_source == A_BETTER_SOURCE
    assert len(stored) == 2
    assert {value.data_source for value in stored} == {A_BETTER_SOURCE, A_WORSE_SOURCE}


async def test_the_drill_down_can_be_asked_for_the_active_value_only(
    values: PostgresValueStore,
) -> None:
    await values.append(
        [
            a_value(
                attribute=A_COUNT_ATTRIBUTE, payload=Count(count=100), data_source=A_WORSE_SOURCE
            ),
            a_value(
                attribute=A_COUNT_ATTRIBUTE, payload=Count(count=200), data_source=A_BETTER_SOURCE
            ),
        ]
    )

    only_active = await values.read_values(attribute=A_COUNT_ATTRIBUTE, include_superseded=False)

    assert [value.data_source for value in only_active] == [A_BETTER_SOURCE]
    assert await values.count_values(attribute=A_COUNT_ATTRIBUTE, include_superseded=False) == 1


async def test_a_page_of_values_is_counted_apart_from_being_read(
    values: PostgresValueStore,
) -> None:
    """`count_values` answers the `total` beside a page, so it must ignore the page."""
    await values.append(
        [
            a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=n), data_source=source)
            for n, source in enumerate((A_BETTER_SOURCE, A_WORSE_SOURCE, "manual"))
        ]
    )

    page = await values.read_values(attribute=A_COUNT_ATTRIBUTE, limit=2, offset=1)

    assert len(page) == 2
    assert await values.count_values(attribute=A_COUNT_ATTRIBUTE) == 3


async def test_a_candidate_nobody_has_fetched_anything_for_has_no_values_at_all(
    values: PostgresValueStore,
) -> None:
    """Not an error and not a zero: the ranking must show it as insufficient data."""
    await values.append([a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=3))])

    assert await values.read_active_values(candidates=[ANOTHER_CANDIDATE]) == ()
    assert await values.read_values(candidate=ANOTHER_CANDIDATE) == ()
    assert await values.count_values(candidate=ANOTHER_CANDIDATE) == 0


async def test_the_three_filters_narrow_independently(values: PostgresValueStore) -> None:
    """A level for the ranking, candidates for a comparison, attributes for a criteria set."""
    await values.append(
        [
            a_value(attribute=A_COUNT_ATTRIBUTE, payload=Count(count=1)),
            a_value(
                attribute=A_COUNT_ATTRIBUTE, payload=Count(count=2), candidate=ANOTHER_CANDIDATE
            ),
            a_value(
                attribute=A_RATIO_ATTRIBUTE,
                payload=Ratio(value=Decimal("3"), basis="total_employment"),
            ),
        ]
    )

    assert len(await values.read_active_values(level="country")) == 3
    assert len(await values.read_active_values(candidates=[A_CANDIDATE])) == 2
    assert len(await values.read_active_values(attributes=[A_COUNT_ATTRIBUTE])) == 2
    assert (
        len(
            await values.read_active_values(
                level="country", candidates=[A_CANDIDATE], attributes=[A_COUNT_ATTRIBUTE]
            )
        )
        == 1
    )


# --- external scores -----------------------------------------------------------------------


def an_external_score(*, candidate: str = A_CANDIDATE, rank: int | None = None) -> ExternalScore:
    return ExternalScore(
        candidate=candidate,
        data_source="numbeo",
        published_scale="0-100",
        reference_period=A_PERIOD,
        retrieval_date=RETRIEVED,
        published_value=Decimal("72.4"),
        published_rank=rank,
        published_rank_of=95 if rank else None,
        methodology_url="https://example.org/method",
        caveats="paywalled",
    )


async def test_an_external_score_is_stored_and_read_back_beside_the_values(
    values: PostgresValueStore,
) -> None:
    """Displayed alongside, never ingested: it is a separate read for a separate reason."""
    score = an_external_score(rank=12)

    assert await values.append_external_score(score) == score

    (stored,) = await values.read_external_scores(candidate=A_CANDIDATE)
    assert stored == score


async def test_external_scores_filter_by_candidate_and_by_level(
    values: PostgresValueStore,
) -> None:
    await values.append_external_score(an_external_score())

    assert len(await values.read_external_scores(level="country")) == 1
    assert await values.read_external_scores(candidate=ANOTHER_CANDIDATE) == ()
    assert await values.read_external_scores(level="city") == ()


async def test_no_external_score_has_ever_been_published_about_anyone(
    values: PostgresValueStore,
) -> None:
    assert await values.read_external_scores() == ()
