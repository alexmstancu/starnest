"""The first of the two dates: what period a figure describes.

Whether a period has aged past its attribute's `max_age` is not answered here: the `active_value`
view's `is_fresh` is the one answer (PL-064), tested in `tests/storage/`.
"""

from datetime import date

import pytest
from pydantic import ValidationError

from starnest.data import InvalidReferencePeriodError, ReferencePeriod


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
