"""The regional CSV becoming one mean per country: horizon, ensemble, and loud refusal.

The sample rows are a **constructed** long-format table (region, year, value) in the shape the
ECDE regional download is documented to take; its exact column names are the thing the first live
fetch confirms. These tests pin the averaging and the failure behaviour, which do not depend on
the real file existing.
"""

from decimal import Decimal

import pytest

from starnest.data_sources.copernicus.response import (
    CopernicusError,
    heat_days_by_country,
)

HORIZON = {"horizon_start": 2041, "horizon_end": 2070}


def test_it_averages_the_horizon_years_per_country() -> None:
    csv = "nuts_id,year,value\nDE,2041,15\nDE,2055,17\nDE,2070,19\nFR,2050,20\n"

    means = heat_days_by_country(csv, **HORIZON)

    assert means["DE"] == Decimal(17)  # (15 + 17 + 19) / 3
    assert means["FR"] == Decimal(20)


def test_it_ignores_years_outside_the_window() -> None:
    csv = "nuts_id,year,value\nDE,2030,99\nDE,2041,10\nDE,2099,99\n"

    assert heat_days_by_country(csv, **HORIZON) == {"DE": Decimal(10)}


def test_a_country_with_no_year_in_the_window_is_absent_not_zero() -> None:
    csv = "nuts_id,year,value\nDE,2041,12\nES,2035,40\n"

    means = heat_days_by_country(csv, **HORIZON)

    assert "ES" not in means  # coverage, never a fabricated zero


def test_a_date_valued_year_column_reads_its_leading_year() -> None:
    csv = "nuts_id,date,value\nIT,2050-01-01,30\n"

    assert heat_days_by_country(csv, **HORIZON) == {"IT": Decimal(30)}


def test_it_averages_several_rows_per_year_as_ensemble_members() -> None:
    # One row per member per year is how a split ensemble would arrive; every row in the window is
    # simply one term of the mean.
    csv = "nuts_id,year,value\nPL,2041,10\nPL,2041,20\nPL,2042,30\n"

    assert heat_days_by_country(csv, **HORIZON) == {"PL": Decimal(20)}


def test_blank_and_unparseable_values_are_skipped() -> None:
    csv = "nuts_id,year,value\nNL,2041,\nNL,2042,n/a\nNL,2043,8\n"

    assert heat_days_by_country(csv, **HORIZON) == {"NL": Decimal(8)}


def test_region_and_value_casing_in_headers_is_tolerated() -> None:
    csv = "NUTS_ID,Year,MEAN\nSE,2050,25\n"

    assert heat_days_by_country(csv, **HORIZON) == {"SE": Decimal(25)}


def test_a_missing_region_column_fails_loudly_naming_what_it_saw() -> None:
    csv = "country_name,year,value\nGermany,2050,15\n"

    with pytest.raises(CopernicusError) as raised:
        heat_days_by_country(csv, **HORIZON)
    assert "region" in str(raised.value)
    assert "country_name" in str(raised.value)


def test_a_missing_value_column_fails_loudly() -> None:
    csv = "nuts_id,year\nDE,2050\n"

    with pytest.raises(CopernicusError):
        heat_days_by_country(csv, **HORIZON)


def test_an_empty_file_with_no_header_is_refused() -> None:
    with pytest.raises(CopernicusError):
        heat_days_by_country("", **HORIZON)
