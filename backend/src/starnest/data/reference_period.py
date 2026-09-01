"""What period a figure describes -- the first of the two dates every value carries.

`reqs.md` 3.6. "Average temperature 2025" is a year, "rent, July 2026" a month, an fx rate a
single day. A single point date could not express which of the three it was, so the pair is
stored and both are displayed.

**The second date is not here, and that is the point.** `retrieval_date` -- when the app
fetched the figure -- lives on the `Value` as a `datetime`, because it is an instant in a
timezone rather than a span in the world (`arch.md` 9.6). The two are different types, so
merging them is not something anyone can do by accident.
"""

from datetime import date, timedelta
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator


class InvalidReferencePeriodError(ValueError):
    """A period does not describe a span: it ends before it begins."""


class ReferencePeriod(BaseModel):
    """The span of the world a figure is about, from `start` to `end` inclusive.

    Both ends are stored even when they are equal, because "one day" is a real answer and
    not a missing one.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    start: date
    end: date

    @model_validator(mode="after")
    def _reject_a_period_that_ends_before_it_begins(self) -> "ReferencePeriod":
        if self.end < self.start:
            raise InvalidReferencePeriodError(
                f"a reference period from {self.start} to {self.end} ends before it begins"
            )
        return self

    @classmethod
    def on_day(cls, day: date) -> Self:
        """A single day -- what an fx rate or a spot observation describes."""
        return cls(start=day, end=day)

    @classmethod
    def covering_year(cls, year: int) -> Self:
        """A whole calendar year -- what most official statistics describe."""
        return cls(start=date(year, 1, 1), end=date(year, 12, 31))

    @property
    def is_a_single_day(self) -> bool:
        """Whether the span is one day, as an fx rate's is."""
        return self.start == self.end

    def covers(self, day: date) -> bool:
        """Whether the span includes this day, both ends counting as inside."""
        return self.start <= day <= self.end

    def has_aged_past(self, max_age: timedelta | None, *, on: date) -> bool:
        """Whether the figure has gone stale by the attribute's `max_age`, as of `on`.

        Age is measured from **what the data describes**, not from when it was downloaded:
        rent from 2019 fetched this morning is stale rent. This mirrors the `is_fresh`
        expression of the `active_value` view (`arch.md` 4, rule 2), which is why the
        comparison is against `end` and why an attribute declaring no `max_age` never
        goes stale.
        """
        if max_age is None:
            return False
        return self.end + max_age < on
