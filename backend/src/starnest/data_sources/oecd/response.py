"""Reading SDMX-JSON, where a series is a colon-separated list of positions.

A series key such as `"4:2:1:3:0:1:0"` says: the fifth value of the first dimension, the third
of the second, and so on, in the order `structure.dimensions.series` lists them. Observations
are keyed the same way against `structure.dimensions.observation`, which here is time alone. So
reading a figure is arithmetic against the structure rather than a lookup by name -- the reason
this module exists apart from the adapter.

**A null observation is not a reading.** SDMX-JSON pads a series with nulls where a period was
not published, and a null is not a zero (`reqs.md` 5.3).
"""

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

AREA = "REF_AREA"


class OecdError(ValueError):
    """The response was not the SDMX-JSON this parser knows how to read, or it was ambiguous."""


def figures(document: Any, selection: Mapping[str, str]) -> dict[str, dict[str, Decimal]]:
    """Each area's figures for the one series `selection` picks out, by period.

    **Ambiguity is an error, not a choice.** If two series for the same area both match -- because
    the selection names too few dimensions -- the decoder refuses. Taking the first would silently
    pick a household type, an income level or a unit, and the figure would look right while
    describing somebody else.
    """
    structure, series = _parts(document)
    names, values = _series_dimensions(structure)
    periods = _periods(structure)

    unknown = set(selection) - set(names)
    if unknown:
        raise OecdError(f"the dataflow has no dimension called {', '.join(sorted(unknown))}")

    found: dict[str, dict[str, Decimal]] = {}
    for key, body in series.items():
        position = _decode(key, names, values)
        if any(position.get(name) != wanted for name, wanted in selection.items()):
            continue
        area = position[AREA]
        if area in found:
            raise OecdError(
                f"more than one series matches for {area}, so the selection names too few "
                "dimensions to say which figure is meant"
            )
        found[area] = _observations(body, periods)
    return found


def _parts(document: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(document, dict) or not isinstance(document.get("data"), dict):
        raise OecdError("the oecd answered without its usual data object")
    errors = document.get("errors")
    if errors:
        raise OecdError(f"the oecd reported errors: {errors}")
    data = document["data"]
    try:
        return data["structure"], data["dataSets"][0]["series"]
    except (KeyError, IndexError, TypeError) as missing:
        raise OecdError("the oecd answered without a structure and a dataset") from missing


def _series_dimensions(structure: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    try:
        dimensions = structure["dimensions"]["series"]
        names = [dimension["id"] for dimension in dimensions]
        values = [[value["id"] for value in dimension["values"]] for dimension in dimensions]
    except (KeyError, TypeError) as missing:
        raise OecdError("the oecd answered with series dimensions this parser cannot read") from (
            missing
        )
    if AREA not in names:
        raise OecdError("the oecd answered with no reference-area dimension")
    return names, values


def _periods(structure: dict[str, Any]) -> list[str]:
    try:
        return [value["id"] for value in structure["dimensions"]["observation"][0]["values"]]
    except (KeyError, IndexError, TypeError) as missing:
        raise OecdError("the oecd answered with no time dimension") from missing


def _decode(key: str, names: list[str], values: list[list[str]]) -> dict[str, str]:
    try:
        positions = [int(part) for part in key.split(":")]
        return {
            name: values[n][position]
            for n, (name, position) in enumerate(zip(names, positions, strict=True))
        }
    except (ValueError, IndexError) as unreadable:
        raise OecdError(f"{key!r} is not a series key this structure can decode") from unreadable


def _observations(body: Any, periods: list[str]) -> dict[str, Decimal]:
    readings: dict[str, Decimal] = {}
    for index, observation in (body.get("observations") or {}).items():
        figure = observation[0] if isinstance(observation, list) and observation else None
        if figure is None:
            continue
        try:
            readings[periods[int(index)]] = Decimal(str(figure))
        except (ValueError, IndexError, InvalidOperation) as unreadable:
            raise OecdError(f"observation {index!r} is not a figure this parser can read") from (
                unreadable
            )
    return readings
