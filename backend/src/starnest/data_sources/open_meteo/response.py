"""Open-Meteo's daily archive answer, read into one series of readings per place."""

from collections.abc import Sequence
from decimal import Decimal


class OpenMeteoError(ValueError):
    """The answer is not the shape the archive API documents."""


def daily_series(document: object, variable: str, places: int) -> list[list[Decimal | None]]:
    """One list of daily readings per place asked about, in the order they were asked.

    The API answers one place as an object and several as a list; both are read here, so the
    adapter never has to know which it asked for. A missing reading stays `None` -- whether a
    year with gaps still has a mean is the adapter's question, not this one's.
    """
    locations = document if isinstance(document, list) else [document]
    if len(locations) != places:
        raise OpenMeteoError(f"asked about {places} places and was answered about {len(locations)}")
    series = []
    for location in locations:
        readings = location.get("daily", {}).get(variable) if isinstance(location, dict) else None
        if not isinstance(readings, Sequence):
            raise OpenMeteoError(f"the answer carries no daily {variable!r} series")
        series.append([None if r is None else Decimal(str(r)) for r in readings])
    return series
