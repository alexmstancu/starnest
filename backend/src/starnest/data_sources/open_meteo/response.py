"""Open-Meteo's daily archive answer, read into one series of readings per place."""

from collections.abc import Sequence
from decimal import Decimal, InvalidOperation


class OpenMeteoError(ValueError):
    """The answer is not the shape the archive API documents."""


def daily_series(
    document: object, variable: str, places: int, expected_days: int
) -> list[list[Decimal | None]]:
    """One list of daily readings per place asked about, in the order they were asked.

    The API answers one place as an object and several as a list; both are read here, so the
    adapter never has to know which it asked for. A missing reading stays `None` -- whether a
    year with gaps still has a mean is the adapter's question, not this one's.

    **The series must cover the window that was asked for** (BE-26). Open-Meteo returns one
    reading per day between the requested `start_date` and `end_date`, so a series of any other
    length is a truncated or misaligned answer -- and averaging one returned day as though it
    were a whole year is exactly the full-period label over partial data `reqs.md` 10 forbids.
    Where `daily.time` is present it must align with the readings, for the same reason.
    """
    locations = document if isinstance(document, list) else [document]
    if len(locations) != places:
        raise OpenMeteoError(f"asked about {places} places and was answered about {len(locations)}")
    series = []
    for location in locations:
        daily = location.get("daily", {}) if isinstance(location, dict) else {}
        readings = daily.get(variable)
        if not isinstance(readings, Sequence) or isinstance(readings, str | bytes):
            raise OpenMeteoError(f"the answer carries no daily {variable!r} series")
        if len(readings) != expected_days:
            raise OpenMeteoError(
                f"the daily {variable!r} series carries {len(readings)} reading(s) for a window "
                f"of {expected_days} day(s); a short answer is not a full period"
            )
        dates = daily.get("time")
        if (
            isinstance(dates, Sequence)
            and not isinstance(dates, str | bytes)
            and len(dates) != len(readings)
        ):
            raise OpenMeteoError(
                f"the daily {variable!r} series and its dates disagree on length "
                f"({len(readings)} readings, {len(dates)} dates)"
            )
        series.append([_a_reading(reading, variable) for reading in readings])
    return series


def _a_reading(raw: object, variable: str) -> Decimal | None:
    """One day's reading as a `Decimal`, or `None` for a gap.

    **A non-numeric reading is a malformed answer, not a crash** (BE-20): `Decimal(str(raw))`
    raised `InvalidOperation`, which is an `ArithmeticError` and so escaped the adapter's
    `OpenMeteoError` catch -- aborting the whole run and losing the item. Raised as the source
    error it is, it becomes one candidate's recorded failure and the run goes on.
    """
    if raw is None:
        return None
    try:
        return Decimal(str(raw))
    except InvalidOperation:
        raise OpenMeteoError(
            f"the daily {variable!r} series carries a non-numeric reading {raw!r}"
        ) from None
