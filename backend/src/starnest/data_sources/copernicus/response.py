"""The regional NetCDF the CDS returns, turned into one ensemble-mean figure per country.

**Pure, and loud when surprised.** No network here -- the adapter hands this the `.nc` file
bytes, already unzipped from the download. Each file is one climate-model run holding the
indicator as a 2-D grid over (NUTS0 region, year).

**One mean per country, equal weight per model.** For each model, the country's mean over the
horizon years is taken; those per-model means are then averaged across the models. Weighting each
*model* equally -- rather than pooling every (model, year) value into one flat mean -- is the
ensemble normal, and it keeps a model that happens to carry fewer years for a country from being
silently down-weighted against the others.

**Confirmed against the live CDS on 2026-10-08.** A request over the whole ensemble returns nine
`.nc` files. In each, the region dimension is `nuts` (two-letter NUTS0 codes, stored as a char
array), `time` is numeric `days since ...` decoded with its own calendar, and the single 2-D
floating variable is the indicator. The indicator is read by its *shape* and oriented by its
*dimension names*, so a second CDS indicator needs no change here.

**Loud when the shape is not what was confirmed.** A file netCDF cannot open, or one with no
region/time coordinate or no 2-D indicator, raises `CopernicusError` with a sentence a run's
failure list can print -- never a mis-read number, which is the failure `reqs.md` 10 prevents.
"""

from collections import defaultdict
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import netCDF4  # type: ignore[import-untyped]
import numpy as np

TIME_UNIT_MARKER = "since"
"""A CF time variable's `units` reads like `days since 1951-01-01`; this word identifies it among
the coordinate variables, so the time axis is found by meaning rather than by a hard-coded name."""


class CopernicusError(Exception):
    """The CDS answered, but not with NetCDF this could read -- unopenable, or missing the
    region, the time, or the 2-D indicator it needs. One exception, carrying a sentence."""


def heat_days_by_country(
    nc_files: Sequence[bytes], *, horizon_start: int, horizon_end: int
) -> dict[str, Decimal]:
    """The ensemble-mean projected hot-day count per NUTS0 country over the horizon.

    Each file contributes one mean per country -- that model's mean over the window years -- and
    those per-model means are averaged. A country a model has no window value for (masked, or
    absent) simply does not contribute that model, rather than dragging the mean toward the models
    that do cover it; a country no model covers is absent from the result, which the adapter turns
    into coverage, never into a zero.
    """
    if not nc_files:
        raise CopernicusError("the CDS download held no NetCDF files")

    per_model_means: dict[str, list[Decimal]] = defaultdict(list)
    for blob in nc_files:
        for region, model_mean in _one_model_means(blob, horizon_start, horizon_end).items():
            per_model_means[region].append(model_mean)
    return {region: _mean(means) for region, means in per_model_means.items() if means}


def _one_model_means(blob: bytes, horizon_start: int, horizon_end: int) -> dict[str, Decimal]:
    """One model file's mean over the horizon window, per region."""
    dataset = _open(blob)
    try:
        time = _time_variable(dataset)
        time_dimension = time.dimensions[0]
        indicator = _indicator_variable(dataset)
        region_dimension = _region_dimension(indicator, time_dimension, dataset)
        regions = _region_codes(dataset, region_dimension)
        years = _years(time)
        grid = _oriented(indicator, region_dimension, time_dimension)
        in_window = (years >= horizon_start) & (years <= horizon_end)

        means: dict[str, Decimal] = {}
        for index, region in enumerate(regions):
            values = np.ma.compressed(grid[index, :][in_window])
            if len(values):
                means[region] = _mean(values)
        return means
    finally:
        dataset.close()


def _open(blob: bytes) -> Any:
    try:
        return netCDF4.Dataset("inmemory.nc", mode="r", memory=blob)
    except OSError as unreadable:
        raise CopernicusError(
            f"the CDS returned bytes netCDF could not open ({unreadable})"
        ) from unreadable


def _time_variable(dataset: Any) -> Any:
    for variable in dataset.variables.values():
        units = getattr(variable, "units", "")
        if variable.ndim == 1 and isinstance(units, str) and TIME_UNIT_MARKER in units:
            return variable
    raise CopernicusError(
        f"the CDS NetCDF has no time coordinate (no 1-D variable with '{TIME_UNIT_MARKER}' units); "
        f"saw variables {sorted(dataset.variables)}"
    )


def _years(time: Any) -> np.ndarray:
    moments = netCDF4.num2date(time[:], time.units, getattr(time, "calendar", "standard"))
    return np.array([moment.year for moment in moments])


def _indicator_variable(dataset: Any) -> Any:
    candidates = [
        variable
        for variable in dataset.variables.values()
        if variable.ndim == 2 and variable.dtype.kind == "f"
    ]
    if len(candidates) != 1:
        raise CopernicusError(
            "the CDS NetCDF does not hold exactly one 2-D floating indicator "
            f"(found {len(candidates)}); saw variables {sorted(dataset.variables)}"
        )
    return candidates[0]


def _region_dimension(indicator: Any, time_dimension: str, dataset: Any) -> str:
    others = [name for name in indicator.dimensions if name != time_dimension]
    if len(others) != 1 or others[0] not in dataset.variables:
        raise CopernicusError(
            f"the CDS NetCDF has no single region coordinate for {indicator.name}: "
            f"dims {indicator.dimensions}, variables {sorted(dataset.variables)}"
        )
    return others[0]


def _region_codes(dataset: Any, region_dimension: str) -> list[str]:
    raw = dataset.variables[region_dimension][:]
    if getattr(raw, "ndim", 1) == 2:  # (region, char) char array, if auto-decoding is off
        raw = netCDF4.chartostring(raw)
    return [str(code).strip().upper() for code in raw]


def _oriented(indicator: Any, region_dimension: str, time_dimension: str) -> np.ndarray:
    """The indicator as (region, year), oriented by dimension *name* so it is unambiguous even
    where the region and year counts happen to be equal."""
    values = indicator[:]
    if indicator.dimensions == (region_dimension, time_dimension):
        return values
    if indicator.dimensions == (time_dimension, region_dimension):
        return values.T
    raise CopernicusError(
        f"the CDS indicator {indicator.name} has dimensions {indicator.dimensions}, "
        f"neither (region, time) nor (time, region) for '{region_dimension}'/'{time_dimension}'"
    )


def _mean(values: Any) -> Decimal:
    """The arithmetic mean as a Decimal, of floats (one model's window years) or of Decimals (the
    per-model means). `Decimal(str(...))` round-trips each term; the sum stays in Decimal space."""
    total = sum(Decimal(str(value)) for value in values)
    return total / Decimal(len(values))
