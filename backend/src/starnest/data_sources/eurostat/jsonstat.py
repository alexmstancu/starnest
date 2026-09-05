"""Reading Eurostat's JSON-stat, which is a dense format for sparse data.

A JSON-stat dataset is an n-dimensional cube flattened into one list. `id` gives the dimension
order, `size` their lengths, and `value` maps a **flat row-major index** to a figure -- so
observation 217 of `[freq, unit, age, sex, geo, time]` is a particular country in a particular
year, and working out which is arithmetic rather than lookup.

**The cube is sparse and that is the point.** Not every country reports every indicator every
year, and Eurostat says so by leaving the index out of `value` entirely. Those gaps are the
honest signal this application is built to preserve (`reqs.md` 5.3, `docs/mine2e.md` M2): a
country with no figure gets no value row, never a zero and never a neighbour's number.

`status` carries Eurostat's own flags against the same indices -- `p` provisional, `b` a break
in the series, `e` estimated. They travel with the observation because a provisional figure is
a different thing to display than a settled one.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


class JsonStatError(ValueError):
    """The response was not the JSON-stat cube this parser knows how to read."""


@dataclass(frozen=True)
class Observation:
    """One figure, for one place, for one period, as Eurostat published it."""

    geo: str
    period: str
    figure: Decimal
    flag: str | None = None


def observations(document: Mapping[str, Any]) -> tuple[Observation, ...]:
    """Every figure the response actually carries, in a stable order.

    Absent observations are absent from the result. There is deliberately no "missing" entry:
    a caller cannot then accidentally treat one as a figure, and the count of what came back is
    the count of what is known.
    """
    dimensions = _dimension_order(document)
    sizes = _sizes(document, dimensions)
    geo_axis = _axis_of("geo", dimensions)
    time_axis = _axis_of("time", dimensions)

    geo_codes = _codes_in_position_order(document, "geo")
    periods = _codes_in_position_order(document, "time")
    strides = _strides(sizes)
    status = document.get("status") or {}

    found = []
    for index, figure in _figures(document):
        geo_position = index // strides[geo_axis] % sizes[geo_axis]
        time_position = index // strides[time_axis] % sizes[time_axis]
        found.append(
            Observation(
                geo=geo_codes[geo_position],
                period=periods[time_position],
                figure=figure,
                flag=status.get(str(index)),
            )
        )
    return tuple(found)


def _figures(document: Mapping[str, Any]) -> list[tuple[int, Decimal]]:
    """The sparse observations, however this response chose to spell "sparse".

    JSON-stat permits both an object keyed by index and a dense array with nulls in the gaps.
    Eurostat sends the object, but reading both costs three lines and means a response in the
    other form is parsed rather than silently yielding nothing.
    """
    values = document.get("value")
    if isinstance(values, Mapping):
        pairs = ((int(index), figure) for index, figure in values.items())
    elif isinstance(values, Sequence) and not isinstance(values, str | bytes):
        pairs = ((index, figure) for index, figure in enumerate(values))
    else:
        raise JsonStatError("the response carries no `value`, so it carries no observations")
    return [(index, _as_decimal(figure)) for index, figure in pairs if figure is not None]


def _as_decimal(figure: object) -> Decimal:
    """A figure as a `Decimal`, never a float.

    Money never becomes a float in this application (`arch.md` 9.6) and a share should not
    either: `Decimal(str(7.1))` is 7.1 where `Decimal(7.1)` is 7.0999999999999996447286321199.
    """
    try:
        return Decimal(str(figure))
    except (InvalidOperation, TypeError) as malformed:
        raise JsonStatError(f"{figure!r} is not a figure this dataset can report") from malformed


def _dimension_order(document: Mapping[str, Any]) -> Sequence[str]:
    order = document.get("id")
    if not isinstance(order, Sequence) or isinstance(order, str) or not order:
        raise JsonStatError("the response names no dimensions, so no index can be decoded")
    return order


def _sizes(document: Mapping[str, Any], dimensions: Sequence[str]) -> Sequence[int]:
    sizes = document.get("size")
    if not isinstance(sizes, Sequence) or len(sizes) != len(dimensions):
        raise JsonStatError(
            f"the response declares {len(dimensions)} dimensions and sizes for a different "
            "number of them, so the cube cannot be read"
        )
    return sizes


def _axis_of(dimension: str, dimensions: Sequence[str]) -> int:
    if dimension not in dimensions:
        raise JsonStatError(
            f"the response has no `{dimension}` dimension; an observation without one cannot be "
            "attached to a place and a period"
        )
    return dimensions.index(dimension)


def _codes_in_position_order(document: Mapping[str, Any], dimension: str) -> list[str]:
    """A dimension's codes, ordered by the position each occupies in the cube.

    `category.index` is a map from code to position and arrives in no guaranteed order, so it
    is inverted rather than iterated -- reading it in key order would attach every figure to the
    wrong country in a way that looks entirely plausible.
    """
    try:
        positions = document["dimension"][dimension]["category"]["index"]
    except (KeyError, TypeError) as missing:
        raise JsonStatError(f"the `{dimension}` dimension carries no category index") from missing
    if isinstance(positions, Sequence) and not isinstance(positions, str):
        return list(positions)
    ordered = sorted(positions.items(), key=lambda pair: pair[1])
    return [code for code, _ in ordered]


def _strides(sizes: Sequence[int]) -> list[int]:
    """How far one step along each dimension moves in the flattened list.

    Row-major, so the last dimension has a stride of 1 and each earlier one multiplies up.
    """
    strides = [1] * len(sizes)
    for axis in range(len(sizes) - 2, -1, -1):
        strides[axis] = strides[axis + 1] * sizes[axis + 1]
    return strides
