"""The regional CSV the CDS returns, turned into one figure per country.

**Pure, and loud when surprised.** No network here -- the adapter hands this the decoded CSV
text. A projection year carries no meaning alone, so the real work is averaging: the years inside
the horizon window, and the ensemble members if the file breaks them out. One mean per NUTS0
country comes out.

**The column names are the one thing an account would be needed to confirm (VERIFY ON FIRST LIVE
FETCH).** Rather than sniff and hope, this resolves each of the three columns it needs against a
small set of plausible names and **raises naming the headers it actually saw** when it cannot.
A wrong assumption therefore stops the first real fetch with the exact remedy -- "add this header
to REGION_COLUMNS" -- instead of filing a mis-read number as a country's heat projection, which is
the plausible-looking figure this application exists to prevent (`reqs.md` 10).
"""

import csv
import io
from collections import defaultdict
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from typing import Final

REGION_COLUMNS: Final = ("nuts_id", "nuts", "nuts0", "region", "region_id", "code", "geo")
YEAR_COLUMNS: Final = ("year", "date", "time", "period")
VALUE_COLUMNS: Final = ("value", "mean", "ensemble_mean", "hot_days", "indicator")
"""Accepted header names for the three columns this reads, lower-cased. Tolerant of a handful of
plausible spellings, loud when none match. Correcting a name after the first live fetch is a
one-line change here."""


class CopernicusError(Exception):
    """The CDS answered, but not with a CSV this could read -- empty, or missing a column it
    needs. One exception, carrying a sentence a run's failure list can print."""


def heat_days_by_country(
    csv_text: str, *, horizon_start: int, horizon_end: int
) -> dict[str, Decimal]:
    """The mean projected hot-day count per NUTS0 country over the horizon window.

    Rows outside `[horizon_start, horizon_end]` are ignored; rows for every country in the file
    are kept. A country with no readable value in the window is simply absent from the result --
    the adapter turns that absence into coverage, never into a zero.
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None:
        raise CopernicusError("the CDS returned an empty CSV with no header row")

    region_key = _column(reader.fieldnames, REGION_COLUMNS, "region")
    year_key = _column(reader.fieldnames, YEAR_COLUMNS, "year")
    value_key = _column(reader.fieldnames, VALUE_COLUMNS, "value")

    gathered: dict[str, list[Decimal]] = defaultdict(list)
    for row in reader:
        year = _an_int(row.get(year_key))
        if year is None or not (horizon_start <= year <= horizon_end):
            continue
        figure = _a_decimal(row.get(value_key))
        region = (row.get(region_key) or "").strip().upper()
        if figure is not None and region != "":
            gathered[region].append(figure)

    return {region: _mean(figures) for region, figures in gathered.items() if figures}


def _column(headers: Iterable[str], accepted: tuple[str, ...], role: str) -> str:
    """The real header matching one of the accepted names, or a refusal naming what was seen.

    Case- and whitespace-insensitive, because a CSV header's casing is the publisher's choice and
    not a fact worth breaking on.
    """
    by_normalised = {header.strip().lower(): header for header in headers}
    for name in accepted:
        if name in by_normalised:
            return by_normalised[name]
    raise CopernicusError(
        f"the CDS CSV has no {role} column: looked for {list(accepted)}, "
        f"saw {sorted(by_normalised.values())}"
    )


def _mean(figures: list[Decimal]) -> Decimal:
    """The arithmetic mean, kept as a Decimal. Averages both the horizon's years and, where the
    file carries one row per ensemble member, the members -- every row for a country in the window
    is simply one term."""
    return sum(figures, Decimal(0)) / Decimal(len(figures))


def _an_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    # A date column may carry '2055' or '2055-01-01'; the year is the leading four digits.
    head = raw.strip()[:4]
    return int(head) if head.isdigit() else None


def _a_decimal(raw: str | None) -> Decimal | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        figure = Decimal(raw.strip())
    except InvalidOperation:
        return None
    return figure if figure.is_finite() else None
