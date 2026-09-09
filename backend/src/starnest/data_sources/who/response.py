"""Reading the Global Health Observatory's OData envelope.

A response is an object with a `value` array, and every row carries the whole indicator at
once -- every country, every year, and **every aggregate**. The aggregates are the reason this
module exists rather than the adapter reading `NumericValue` off each row: a `REGION` row's
`SpatialDim` is a three-letter code like any other, and nothing about its shape says it
describes forty countries rather than one.

**A row with no `NumericValue` is not a reading.** WHO publishes rows whose figure is absent,
and an absent figure is not a zero. Dropped here, so a caller cannot mistake one for a number
(`reqs.md` 5.3).
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from starnest.data_sources.who.manifest import A_COUNTRY


class WhoError(ValueError):
    """The response was not the answer this parser knows how to read."""


@dataclass(frozen=True)
class Reading:
    """One country's figure for one year, as WHO published it.

    `country` is ISO 3166-1 alpha-3, which is what `candidate.country_code_alpha3` holds.
    """

    country: str
    year: int
    figure: Decimal


def readings(document: Any) -> tuple[Reading, ...]:
    """Every country figure the response carries, aggregates left out.

    The filtering is not an optimisation. Keeping a `GLOBAL` or `WORLDBANKINCOMEGROUP` row
    would put a figure describing many countries into the record of one, and it would look
    entirely ordinary on the way past.
    """
    if not isinstance(document, dict) or not isinstance(document.get("value"), list):
        raise WhoError("the global health observatory answered without its usual value array")
    return tuple(
        reading for row in document["value"] if (reading := _reading_from(row)) is not None
    )


def _reading_from(row: Any) -> Reading | None:
    if not isinstance(row, dict):
        raise WhoError("the global health observatory answered with a row that is not an object")
    if row.get("SpatialDimType") != A_COUNTRY:
        return None
    figure = row.get("NumericValue")
    if figure is None:
        return None
    return Reading(
        country=_text(row, "SpatialDim"),
        year=_year(row),
        figure=_decimal(figure),
    )


def _text(row: dict[str, Any], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise WhoError(f"a country row names no {field}")
    return value


def _year(row: dict[str, Any]) -> int:
    """`TimeDim`, which is an integer year on an annual series.

    Refused rather than coerced when it is anything else: WHO publishes some indicators against
    other period types, and reading a non-year as one would put a figure in the wrong year
    without saying so.
    """
    year = row.get("TimeDim")
    if not isinstance(year, int) or isinstance(year, bool):
        raise WhoError(f"{year!r} is not the integer year an annual series reports")
    return year


def _decimal(figure: Any) -> Decimal:
    """Through `str`, because the JSON number is a float and `Decimal(float)` keeps its noise."""
    try:
        return Decimal(str(figure))
    except (InvalidOperation, ValueError) as unreadable:
        raise WhoError(
            f"{figure!r} is not a number the global health observatory could have meant"
        ) from unreadable
