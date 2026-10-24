"""What the database holds at a level, as opposed to what one run did (PL-051, PL-052, PL-054).

A run's accounting describes its own items; a reader asking "what do we have?" needs the
database's. Opening a two-item retry must not make the corpus look like two items, and dismissing
a run's card must not make outstanding gaps disappear -- so these figures are read from the
stored rows, never assembled from whichever run is on screen.
"""

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from starnest.data_acquisition.adapter import AcquisitionFailure


@dataclass(frozen=True)
class MonthlySpend:
    """What runs and gate research cost from `since` on (`reqs.md` 3.8, C04-N1).

    **`since` is the reader's month start**, sent by the browser (C04-N10), so the server makes
    no clock decision. Research is summed from its ledger and never listed row by row.
    """

    since: datetime
    runs_eur: Decimal
    research_eur: Decimal

    @property
    def total_eur(self) -> Decimal:
        return self.runs_eur + self.research_eur


@dataclass(frozen=True)
class Gap:
    """One pair with no value in use, and the latest acquisition that asked about it.

    `data_acquisition_run` is `None` only for a pair no acquisition has ever asked about.
    `failures` is filled only for a failed gap: each source's failure, or the reason the figure it
    stored cannot be used.
    """

    candidate: str
    attribute: str
    data_acquisition_run: int | None
    failures: tuple[AcquisitionFailure, ...] = field(default=())


@dataclass(frozen=True)
class Holdings:
    """The database at one level, read in one statement so its figures add up.

    `values_stored + len(failed) + len(unanswered) + len(not_reached) == pairs_total`, every pair
    in at most one list, and a pair with a value in use in none of them.
    """

    level: str
    pairs_total: int
    values_stored: int
    values_past_allowed_age: int
    # None while the refetch setting is unset: there is no age to be older than.
    values_older_than_refetch_age: int | None
    spent: MonthlySpend
    failed: tuple[Gap, ...] = field(default=())
    unanswered: tuple[Gap, ...] = field(default=())
    not_reached: tuple[Gap, ...] = field(default=())
