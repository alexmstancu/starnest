"""Build small NetCDF files in the shape the CDS returns, for the parser and adapter tests.

The real dataset stores NUTS0 codes as a char array, `time` as `days since 1951-01-01`, and the
indicator as a 2-D (nuts, time) float. `build_nc` reproduces that shape so the tests exercise the
real `netCDF4` read path without a CDS account; `build_custom` is the escape hatch for the
degenerate files the loud-failure tests need; `captured/` holds one real nine-model response for
an end-to-end check.
"""

import io
import os
import tempfile
import zipfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import cftime
import netCDF4  # type: ignore[import-untyped]
import numpy as np


def build_nc(
    regions: Sequence[str],
    years: Sequence[int],
    values: Any,
    *,
    variable: str = "hot_days",
) -> bytes:
    """One model file: `values[i][j]` is the indicator for `regions[i]` in `years[j]`.

    `values` may be a masked array; masked cells are written as the fill value and read back
    masked, which is how a region with no figure for a year arrives.
    """
    grid = np.ma.asarray(values, dtype="f8")

    def populate(dataset: Any) -> None:
        dataset.createDimension("nuts", len(regions))
        dataset.createDimension("time", len(years))
        _write_time(dataset, years)
        write_char_nuts(dataset, regions)
        indicator = dataset.createVariable(variable, "f8", ("nuts", "time"), fill_value=-9999.0)
        indicator[:] = grid

    return build_custom(populate)


def write_char_nuts(dataset: Any, regions: Sequence[str], dimension: str = "nuts") -> None:
    """Write the NUTS codes as a 2-D char array over a `chars` dimension, the way the real file
    stores them -- so the parser's char-array branch is exercised, not only the decoded-string one.
    """
    chars = _nuts_chars(regions)
    dataset.createDimension("chars", chars.shape[1])
    nuts = dataset.createVariable(dimension, "S1", (dimension, "chars"))
    nuts[:] = chars


def _nuts_chars(regions: Sequence[str]) -> np.ndarray:
    width = max(len(code) for code in regions)
    return np.array([list(code.ljust(width)) for code in regions], dtype="S1")


def _write_time(dataset: Any, years: Sequence[int]) -> None:
    time = dataset.createVariable("time", "f8", ("time",))
    time.units = "days since 1951-01-01"
    time.calendar = "proleptic_gregorian"
    time[:] = netCDF4.date2num(
        [cftime.DatetimeProlepticGregorian(year, 1, 1) for year in years],
        time.units,
        time.calendar,
    )


def build_custom(populate: Callable[[Any], None]) -> bytes:
    """Run `populate(dataset)` against a fresh NetCDF and return its bytes. For the degenerate
    files -- a missing time axis, an integer indicator, a region dimension with no coordinate --
    that the loud-failure tests need."""
    handle, path = tempfile.mkstemp(suffix=".nc")
    os.close(handle)
    try:
        dataset = netCDF4.Dataset(path, "w")
        populate(dataset)
        dataset.close()
        return Path(path).read_bytes()
    finally:
        Path(path).unlink()


def zip_of(*nc_blobs: bytes, names: Sequence[str] | None = None) -> bytes:
    """A zip of the given NetCDF files, as the CDS returns one `.nc` per model run."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for index, blob in enumerate(nc_blobs):
            archive.writestr(names[index] if names else f"model_{index}.nc", blob)
    return buffer.getvalue()


def nc_members(zip_bytes: bytes) -> list[bytes]:
    """The `.nc` member bytes of a zip, for parser tests that start from a captured zip."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        return [archive.read(name) for name in sorted(archive.namelist()) if name.endswith(".nc")]
