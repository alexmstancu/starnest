"""Reading the DataMapper envelope, which nests figures three deep.

    {"values": {"NGDP_RPCH": {"ROU": {"2027": 2.5, ...}, ...}}}

**The response contains every economy the IMF publishes, whatever was asked for.** A request
naming four countries comes back with all one hundred and ninety, plus about thirty aggregates
-- `EURO`, `EU`, `SSA`, `WEOWORLD` -- carrying figures for groups of countries under keys that
look exactly like country codes. Several are three uppercase letters, so unlike WHO's, they are
not ruled out by the shape of an alpha-3 code.

**What keeps an aggregate out of a candidate's record is that we never look one up.** The
adapter asks for the codes its own candidates carry, which are ISO's and seeded from ISO, and
none of the thirty-odd aggregate codes is one of them. That is asserted in the tests rather
than assumed, because it is the kind of thing that stays true until an aggregate is added.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


class ImfError(ValueError):
    """The response was not the answer this parser knows how to read."""


@dataclass(frozen=True)
class Projection:
    """One economy's figure for one year, as the IMF published it."""

    country: str
    year: int
    figure: Decimal


def projections(document: Any, indicator: str) -> dict[str, dict[int, Projection]]:
    """Every figure the response carries, by economy and then by year.

    Keyed rather than listed, because the caller wants one specific year for one specific
    country and searching a flat list for it would be the same lookup written longhand.
    """
    if not isinstance(document, dict) or not isinstance(document.get("values"), dict):
        raise ImfError("the imf answered without its usual values object")
    series = document["values"].get(indicator)
    if series is None:
        raise ImfError(f"the imf answered with no series for {indicator}")
    if not isinstance(series, dict):
        raise ImfError(f"the imf answered with a {indicator} series that is not an object")

    found: dict[str, dict[int, Projection]] = {}
    for economy, by_year in series.items():
        if not isinstance(by_year, dict):
            raise ImfError(f"the imf answered with no years for {economy}")
        found[economy] = {
            year: Projection(country=economy, year=year, figure=_decimal(figure))
            for raw_year, figure in by_year.items()
            if figure is not None and (year := _year(raw_year)) is not None
        }
    return found


def _year(raw: Any) -> int | None:
    """The key as a year, or nothing.

    A key that is not a year is skipped rather than refused: the IMF has added metadata keys
    beside the years before, and one appearing should not take a whole fetch down.
    """
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _decimal(figure: Any) -> Decimal:
    """Through `str`, because the JSON number is a float and `Decimal(float)` keeps its noise."""
    try:
        return Decimal(str(figure))
    except (InvalidOperation, ValueError) as unreadable:
        raise ImfError(f"{figure!r} is not a number the imf could have meant") from unreadable
