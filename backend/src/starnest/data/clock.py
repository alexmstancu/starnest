"""Now, as something the domain is handed rather than something it reaches for.

`arch.md` 6.3. Freshness is the reason this exists: whether a value has aged past its
attribute's `max_age` is a comparison against today, and a rule that read the system clock
directly could only be tested by waiting.

The implementation is supplied at startup (`arch.md` 6.8) -- one line in the composition root,
and a fixed clock in a test.
"""

from abc import ABC, abstractmethod
from datetime import date, datetime


class Clock(ABC):
    """The current moment, and the day it falls on."""

    @abstractmethod
    def now(self) -> datetime:
        """The current moment, **timezone-aware**.

        Aware rather than naive because every moment the system records is a `timestamptz`
        (`arch.md` 9.6), and a naive value here would be stored as whatever the connection's
        timezone happened to be.
        """

    def today(self) -> date:
        """The day `now` falls on, which is what staleness is measured against.

        Derived rather than abstract on purpose: two independently overridable answers could
        disagree, and a clock whose `today` was not the day of its `now` would be a genuinely
        confusing thing to debug.
        """
        return self.now().date()
