"""Somebody else's conclusion, kept where it cannot be summed by accident."""

import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    ExternalScore,
    ExternalScoreListing,
    MalformedExternalScoreError,
    ReferencePeriod,
    Value,
    editions_of,
)

RETRIEVED = datetime(2026, 8, 1, tzinfo=UTC)


def a_published_score(**overrides: object) -> ExternalScore:
    fields: dict[str, object] = {
        "candidate": "country.portugal",
        "data_source": "numbeo",
        "series": "Crime Index",
        "published_scale": "0-100",
        "published_value": Decimal("74.3"),
        "reference_period": ReferencePeriod.covering_year(2026),
        "retrieval_date": RETRIEVED,
    }
    return ExternalScore(**(fields | overrides))


class TestWhatAPublishedScoreHolds:
    def test_holds_a_number_and_the_scale_that_makes_it_mean_something(self) -> None:
        score = a_published_score(methodology_url="https://numbeo.com/method", caveats="Paywalled")
        assert score.published_value == Decimal("74.3")
        assert score.published_scale == "0-100"
        assert score.methodology_url == "https://numbeo.com/method"

    def test_holds_a_position_where_the_provider_publishes_one(self) -> None:
        score = a_published_score(
            published_value=None, published_scale="rank", published_rank=12, published_rank_of=95
        )
        assert (score.published_rank, score.published_rank_of) == (12, 95)

    def test_names_the_provider_as_a_source_rather_than_as_a_string(self) -> None:
        """Numbeo supplies both values and a composite; one row means one reliability tier."""
        assert a_published_score().data_source == "numbeo"

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score().published_value = Decimal("99")


class TestItIsNotAValue:
    def test_is_a_separate_type_entirely(self) -> None:
        """A flag on `Value` gets forgotten in a join and silently ends up inside a sum."""
        assert not issubclass(ExternalScore, Value)

    def test_carries_no_payload_that_scoring_could_read(self) -> None:
        assert "payload" not in ExternalScore.model_fields
        assert "value_type" not in ExternalScore.model_fields

    def test_whether_it_is_current_is_derived_and_never_stored_on_it(self) -> None:
        """Like `ValueListing.is_active`: a stored flag would go stale the day an edition lands."""
        assert "is_current" not in ExternalScore.model_fields


class TestWhatItRefuses:
    def test_refuses_a_score_that_publishes_neither_value_nor_rank(self) -> None:
        with pytest.raises(ValidationError) as raised:
            a_published_score(published_value=None)
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedExternalScoreError)

    def test_refuses_a_position_with_no_field_to_be_positioned_in(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_value=None, published_rank=12)

    def test_refuses_being_twelfth_of_five(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_value=None, published_rank=12, published_rank_of=5)

    def test_refuses_a_retrieval_date_with_no_timezone(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(retrieval_date=datetime(2026, 8, 1))

    def test_refuses_a_scale_that_says_nothing(self) -> None:
        with pytest.raises(ValidationError):
            a_published_score(published_scale="")

    @pytest.mark.parametrize("series", ["", "   "])
    def test_refuses_a_series_that_names_nothing(self, series: str) -> None:
        """D64: which index a figure is an edition of is what tells two of one publisher apart."""
        with pytest.raises(ValidationError):
            a_published_score(series=series)


def an_edition(
    *,
    end: date,
    start: date = date(2026, 1, 1),
    retrieved: datetime = RETRIEVED,
    **overrides: object,
) -> ExternalScore:
    return a_published_score(
        reference_period=ReferencePeriod(start=start, end=end),
        retrieval_date=retrieved,
        **overrides,
    )


def current_of(listings: tuple[ExternalScoreListing, ...]) -> list[ExternalScore]:
    return [listing.score for listing in listings if listing.is_current]


class TestWhichEditionIsCurrent:
    """ST-10 (D64): one current edition per candidate, publisher and series; the rest history."""

    def test_the_edition_ending_latest_is_current_and_the_earlier_one_is_history(self) -> None:
        earlier = an_edition(end=date(2025, 12, 31), start=date(2025, 1, 1))
        later = an_edition(end=date(2026, 12, 31))

        listings = editions_of([earlier, later])

        assert [(listing.score, listing.is_current) for listing in listings] == [
            (later, True),
            (earlier, False),
        ]

    def test_an_annual_edition_outranks_a_monthly_one_sharing_its_start(self) -> None:
        """Ordered by period end, then start: the year runs later than its January."""
        monthly = an_edition(end=date(2026, 1, 31))
        annual = an_edition(end=date(2026, 12, 31))

        assert current_of(editions_of([monthly, annual])) == [annual]

    def test_of_two_ending_together_the_one_starting_later_is_current(self) -> None:
        annual = an_edition(start=date(2026, 1, 1), end=date(2026, 12, 31))
        monthly = an_edition(start=date(2026, 12, 1), end=date(2026, 12, 31))

        assert current_of(editions_of([annual, monthly])) == [monthly]

    def test_a_re_read_of_one_edition_collapses_to_the_latest_read(self) -> None:
        """Not history: the same edition read twice is one edition, shown once."""
        first_read = an_edition(end=date(2026, 12, 31))
        re_read = an_edition(end=date(2026, 12, 31), retrieved=RETRIEVED + timedelta(days=30))

        listings = editions_of([re_read, first_read])

        assert [(listing.score, listing.is_current) for listing in listings] == [(re_read, True)]

    @pytest.mark.parametrize(
        "other",
        [
            pytest.param({"data_source": "wherenext"}, id="another publisher"),
            pytest.param({"series": "Quality of Life Index"}, id="another series"),
            pytest.param({"candidate": "country.spain"}, id="another candidate"),
        ],
    )
    def test_each_publisher_series_and_candidate_has_its_own_current_edition(
        self, other: dict
    ) -> None:
        older_here = an_edition(end=date(2025, 12, 31), start=date(2025, 1, 1))
        here = an_edition(end=date(2026, 12, 31))
        there = an_edition(end=date(2024, 12, 31), start=date(2024, 1, 1), **other)

        current = current_of(editions_of([older_here, here, there]))

        assert len(current) == 2
        assert here in current and there in current

    def test_a_switched_off_publisher_is_listed_with_no_current_edition(self) -> None:
        """Q232: a switched-off source is kept and shown, and never the one that stands."""
        numbeo = an_edition(end=date(2026, 12, 31))
        wherenext = an_edition(end=date(2026, 12, 31), data_source="wherenext")

        listings = editions_of([numbeo, wherenext], switched_off={"numbeo"})

        assert {(listing.score.data_source, listing.is_current) for listing in listings} == {
            ("numbeo", False),
            ("wherenext", True),
        }

    def test_the_order_is_the_same_whatever_order_the_editions_arrive_in(self) -> None:
        editions = [
            an_edition(end=date(2026, 12, 31)),
            an_edition(end=date(2026, 1, 31)),
            an_edition(end=date(2025, 12, 31), start=date(2025, 1, 1)),
            an_edition(end=date(2026, 12, 31), series="Quality of Life Index"),
            an_edition(end=date(2026, 12, 31), data_source="wherenext"),
            an_edition(end=date(2026, 12, 31), candidate="country.spain"),
        ]
        shuffled = editions.copy()
        random.Random(7).shuffle(shuffled)

        assert editions_of(shuffled) == editions_of(editions)

    def test_nothing_published_lists_nothing(self) -> None:
        assert editions_of([]) == ()
