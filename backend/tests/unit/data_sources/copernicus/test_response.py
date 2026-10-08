"""The regional NetCDF becoming one ensemble mean per country: horizon, models, loud refusal.

The synthetic files are built in the real file's shape (char NUTS codes, `days since` time, a 2-D
float indicator), so the `netCDF4` read path is exercised without a CDS account. One test reads
the captured nine-model response, so the parser is also held against bytes the live API produced.
"""

from decimal import Decimal
from pathlib import Path

import netCDF4  # type: ignore[import-untyped]
import numpy as np
import pytest

from starnest.data_sources.copernicus.response import CopernicusError, heat_days_by_country

from .nc_builder import build_custom, build_nc, nc_members, write_char_nuts

HORIZON = {"horizon_start": 2041, "horizon_end": 2070}
CAPTURED = Path(__file__).parent / "captured"


def test_it_averages_the_horizon_years_per_country() -> None:
    nc = build_nc(["DE"], [2041, 2055, 2070], [[15, 17, 19]])

    means = heat_days_by_country([nc], **HORIZON)

    assert means["DE"] == Decimal(17)  # (15 + 17 + 19) / 3


def test_it_averages_across_the_models_of_the_ensemble() -> None:
    # Two model files, same country and year: each is one term of the ensemble mean.
    cooler = build_nc(["PL"], [2050], [[10]])
    warmer = build_nc(["PL"], [2050], [[20]])

    assert heat_days_by_country([cooler, warmer], **HORIZON) == {"PL": Decimal(15)}


def test_each_model_is_weighted_equally_regardless_of_its_year_count() -> None:
    # One model carries two window years, the other one. The ensemble weights the two *models*
    # equally -- (15 + 30) / 2 = 22.5 -- not every (model, year) term, which would give 20.
    two_years = build_nc(["PL"], [2050, 2051], [[10, 20]])  # this model's mean: 15
    one_year = build_nc(["PL"], [2050], [[30]])  # this model's mean: 30

    assert heat_days_by_country([two_years, one_year], **HORIZON) == {"PL": Decimal("22.5")}


def test_it_ignores_years_outside_the_window() -> None:
    nc = build_nc(["DE"], [2030, 2041, 2099], [[99, 10, 99]])

    assert heat_days_by_country([nc], **HORIZON) == {"DE": Decimal(10)}


def test_a_country_with_no_year_in_the_window_is_absent_not_zero() -> None:
    grid = np.ma.masked_array([[12, 0], [0, 40]], mask=[[False, True], [True, False]])
    nc = build_nc(["DE", "ES"], [2041, 2035], grid)

    means = heat_days_by_country([nc], **HORIZON)

    assert means["DE"] == Decimal(12)
    assert "ES" not in means  # its only value is at 2035, outside the window and masked


def test_a_masked_cell_is_skipped() -> None:
    grid = np.ma.masked_array([[8, -1, 10]], mask=[[False, True, False]])
    nc = build_nc(["NL"], [2041, 2050, 2060], grid)

    assert heat_days_by_country([nc], **HORIZON) == {"NL": Decimal(9)}  # (8 + 10) / 2


def test_nuts_codes_are_kept_as_the_file_writes_them() -> None:
    # EL and UK stay EL and UK; mapping to ISO is the adapter's job, not the parser's.
    nc = build_nc(["EL", "UK"], [2050], [[40], [1]])

    means = heat_days_by_country([nc], **HORIZON)

    assert set(means) == {"EL", "UK"}


def test_the_indicator_stored_as_time_by_region_is_read_too() -> None:
    def transposed(dataset: object) -> None:
        import cftime

        dataset.createDimension("time", 2)  # type: ignore[attr-defined]
        dataset.createDimension("nuts", 1)  # type: ignore[attr-defined]
        time = dataset.createVariable("time", "f8", ("time",))  # type: ignore[attr-defined]
        time.units = "days since 1951-01-01"
        time.calendar = "proleptic_gregorian"
        time[:] = netCDF4.date2num(
            [cftime.DatetimeProlepticGregorian(y, 1, 1) for y in (2050, 2060)],
            time.units,
            time.calendar,
        )
        write_char_nuts(dataset, ["DE"])
        indicator = dataset.createVariable("hot_days", "f8", ("time", "nuts"))  # type: ignore[attr-defined]
        indicator[:] = [[10], [20]]

    assert heat_days_by_country([build_custom(transposed)], **HORIZON) == {"DE": Decimal(15)}


def test_an_empty_download_is_refused() -> None:
    with pytest.raises(CopernicusError, match="no NetCDF"):
        heat_days_by_country([], **HORIZON)


def test_bytes_netcdf_cannot_open_are_refused_loudly() -> None:
    with pytest.raises(CopernicusError, match="could not open"):
        heat_days_by_country([b"this is not a NetCDF file"], **HORIZON)


def test_a_file_with_no_time_coordinate_is_refused() -> None:
    def no_time(dataset: object) -> None:
        dataset.createDimension("nuts", 1)  # type: ignore[attr-defined]
        dataset.createDimension("step", 2)  # type: ignore[attr-defined]
        write_char_nuts(dataset, ["DE"])
        indicator = dataset.createVariable("hot_days", "f8", ("nuts", "step"))  # type: ignore[attr-defined]
        indicator[:] = [[1, 2]]

    with pytest.raises(CopernicusError, match="time"):
        heat_days_by_country([build_custom(no_time)], **HORIZON)


def test_a_file_with_no_floating_indicator_is_refused() -> None:
    def integer_indicator(dataset: object) -> None:
        import cftime

        dataset.createDimension("nuts", 1)  # type: ignore[attr-defined]
        dataset.createDimension("time", 1)  # type: ignore[attr-defined]
        time = dataset.createVariable("time", "f8", ("time",))  # type: ignore[attr-defined]
        time.units = "days since 1951-01-01"
        time.calendar = "proleptic_gregorian"
        time[:] = netCDF4.date2num(
            [cftime.DatetimeProlepticGregorian(2050, 1, 1)], time.units, time.calendar
        )
        write_char_nuts(dataset, ["DE"])
        indicator = dataset.createVariable("hot_days", "i4", ("nuts", "time"))  # type: ignore[attr-defined]
        indicator[:] = [[7]]

    with pytest.raises(CopernicusError, match="indicator"):
        heat_days_by_country([build_custom(integer_indicator)], **HORIZON)


def test_a_file_with_no_region_coordinate_is_refused() -> None:
    def no_region_coord(dataset: object) -> None:
        import cftime

        dataset.createDimension("time", 1)  # type: ignore[attr-defined]
        dataset.createDimension("places", 2)  # type: ignore[attr-defined]
        time = dataset.createVariable("time", "f8", ("time",))  # type: ignore[attr-defined]
        time.units = "days since 1951-01-01"
        time.calendar = "proleptic_gregorian"
        time[:] = netCDF4.date2num(
            [cftime.DatetimeProlepticGregorian(2050, 1, 1)], time.units, time.calendar
        )
        indicator = dataset.createVariable("hot_days", "f8", ("places", "time"))  # type: ignore[attr-defined]
        indicator[:] = [[1], [2]]  # 'places' has no coordinate variable

    with pytest.raises(CopernicusError, match="region"):
        heat_days_by_country([build_custom(no_region_coord)], **HORIZON)


def test_it_reads_the_captured_nine_model_response() -> None:
    blobs = nc_members((CAPTURED / "hot_days_nuts0_rcp45.zip").read_bytes())

    means = heat_days_by_country(blobs, **HORIZON)

    assert len(blobs) == 9
    # Physically sensible and discriminating: the warm south, the cool north.
    assert abs(means["CY"] - Decimal("62.045405")) < Decimal("0.001")  # Cyprus
    assert abs(means["ES"] - Decimal("54.057722")) < Decimal("0.001")  # Spain
    assert abs(means["DE"] - Decimal("8.958066")) < Decimal("0.001")  # Germany
    assert abs(means["UK"] - Decimal("0.361019")) < Decimal("0.001")  # United Kingdom
