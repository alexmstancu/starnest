"""The first of the two dates, and the staleness question it answers.

Every assertion about `has_aged_past` is really an assertion about the `is_fresh` expression
in the `active_value` view (`arch.md` 4): age is measured from what the data describes, not
from when it was downloaded.
"""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from starnest.data import InvalidReferencePeriodError, ReferencePeriod

A_YEAR = timedelta(days=365)


class TestWhatAPeriodAccepts:
    def test_holds_a_span_of_two_dates(self) -> None:
        period = ReferencePeriod(start=date(2026, 7, 1), end=date(2026, 7, 31))
        assert period.start == date(2026, 7, 1)
        assert period.end == date(2026, 7, 31)
        assert not period.is_a_single_day

    def test_a_single_day_is_a_period_with_both_ends_equal(self) -> None:
        """What an fx rate describes. A point date could not say it was one day."""
        period = ReferencePeriod.on_day(date(2026, 7, 1))
        assert period.is_a_single_day
        assert period.start == period.end

    def test_a_calendar_year_runs_january_to_december(self) -> None:
        period = ReferencePeriod.covering_year(2025)
        assert (period.start, period.end) == (date(2025, 1, 1), date(2025, 12, 31))

    @pytest.mark.parametrize(
        ("day", "covered"),
        [
            (date(2025, 12, 31), False),
            (date(2026, 1, 1), True),
            (date(2026, 6, 15), True),
            (date(2026, 12, 31), True),
            (date(2027, 1, 1), False),
        ],
    )
    def test_covers_both_ends_and_everything_between(self, day: date, covered: bool) -> None:
        assert ReferencePeriod.covering_year(2026).covers(day) is covered

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            ReferencePeriod.covering_year(2026).start = date(2020, 1, 1)


class TestWhatAPeriodRefuses:
    def test_refuses_a_period_that_ends_before_it_begins(self) -> None:
        with pytest.raises(ValidationError) as raised:
            ReferencePeriod(start=date(2026, 7, 31), end=date(2026, 7, 1))
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], InvalidReferencePeriodError)

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            ReferencePeriod(start=date(2026, 1, 1), end=date(2026, 1, 1), retrieval_date="now")


class TestGoingStale:
    def test_a_figure_within_max_age_is_fresh(self) -> None:
        period = ReferencePeriod.covering_year(2026)
        assert period.has_aged_past(A_YEAR, on=date(2027, 6, 1)) is False

    def test_a_figure_past_max_age_is_stale(self) -> None:
        period = ReferencePeriod.covering_year(2019)
        assert period.has_aged_past(A_YEAR, on=date(2026, 8, 19)) is True

    def test_the_day_max_age_expires_still_counts_as_fresh(self) -> None:
        """The view compares with `>=`, so the boundary day is fresh. So does this."""
        period = ReferencePeriod.on_day(date(2026, 1, 1))
        assert period.has_aged_past(A_YEAR, on=date(2027, 1, 1)) is False
        assert period.has_aged_past(A_YEAR, on=date(2027, 1, 2)) is True

    def test_an_attribute_declaring_no_max_age_never_goes_stale(self) -> None:
        """A coastline does not age (`reqs.md` 6.6)."""
        assert (
            ReferencePeriod.covering_year(1900).has_aged_past(None, on=date(2026, 8, 19)) is False
        )
