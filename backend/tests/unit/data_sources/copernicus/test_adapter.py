"""The CDS job protocol becoming stored values, driven through a stubbed transport.

The four HTTP steps -- submit, poll, read the result, download -- are simulated with
`httpx.MockTransport`, so the protocol is exercised without a CDS account. The download payloads
are NetCDF built in the real file's shape, and one test replays the captured nine-model zip the
live API actually returned.
"""

import io
import zipfile
from collections.abc import Callable
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    QuantityParameters,
    UnitId,
    ValueType,
)
from starnest.data_sources.copernicus import COPERNICUS, CopernicusAdapter

from .nc_builder import build_nc, zip_of

COUNTRY = {"id": "country", "depth_order": 1}
HEAT = "country.projected_summer_heat_days"
CAPTURED = Path(__file__).parent / "captured"

# DE averages 15/17/19 = 17 over the window; EL is 40, FR is 20. One shared time axis, as a real
# file has, with each country's row filled across it.
SAMPLE_ZIP = zip_of(
    build_nc(
        ["DE", "EL", "FR"],
        [2041, 2055, 2070],
        [[15, 17, 19], [40, 40, 40], [20, 20, 20]],
    )
)


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": HEAT,
        "name": "Projected summer heat days",
        "level": "country",
        "value_type": ValueType.QUANTITY,
        "pillar": "climate",
        "quantity_parameters": QuantityParameters(unit=UnitId("days_per_year")),
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, alpha2: str | None) -> Candidate:
    return Candidate(
        id=f"country.{name}",
        name=name.title(),
        level=COUNTRY,
        country_code=alpha2,
        country_code_alpha3=None,
    )


FOUR_COUNTRIES = [
    a_country("germany", "DE"),
    a_country("greece", "GR"),  # Greece is EL in NUTS, GR in ISO
    a_country("france", "FR"),
    a_country("malta", "MT"),  # absent from the sample file
]


def _responder(
    *,
    download: bytes = SAMPLE_ZIP,
    execute_status: str = "successful",
    poll_statuses: tuple[str, ...] = (),
    results_doc: dict[str, object] | None = None,
    seen: list[httpx.Request] | None = None,
) -> Callable[[httpx.Request], httpx.Response]:
    polls = iter(poll_statuses)

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        path = request.url.path
        if path.endswith("/execute"):
            return httpx.Response(200, json={"jobID": "job-1", "status": execute_status})
        if "/jobs/" in path and path.endswith("/results"):
            doc = (
                results_doc
                if results_doc is not None
                else {"asset": {"value": {"href": "https://download.test/result.zip"}}}
            )
            return httpx.Response(200, json=doc)
        if "/jobs/" in path:
            return httpx.Response(200, json={"status": next(polls, "successful")})
        return httpx.Response(200, content=download)

    return handle


def _adapter(
    handle: Callable[[httpx.Request], httpx.Response], *, token: str | None = "tok"
) -> CopernicusAdapter:
    return CopernicusAdapter(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), token, poll_seconds=0
    )


def _by_candidate(values: tuple) -> dict:
    return {str(value.candidate): value for value in values}


async def test_it_submits_reads_and_builds_a_quantity_per_country() -> None:
    result = await _adapter(_responder()).fetch(an_attribute(), FOUR_COUNTRIES)

    germany = _by_candidate(result.values)["country.germany"]
    assert germany.payload.magnitude == Decimal(17)  # (15 + 17 + 19) / 3
    assert str(germany.payload.unit) == "days_per_year"
    assert germany.data_source == COPERNICUS
    assert germany.confidence_level is ConfidenceLevel.MEDIUM
    assert germany.reference_period.start == date(2041, 1, 1)
    assert germany.reference_period.end == date(2070, 12, 31)
    assert "RCP4.5" in (germany.quote or "")


async def test_greek_nuts_code_el_maps_to_the_iso_code_gr() -> None:
    result = await _adapter(_responder()).fetch(an_attribute(), FOUR_COUNTRIES)

    greece = _by_candidate(result.values)["country.greece"]
    assert greece.payload.magnitude == Decimal(40)


async def test_a_mapped_country_with_a_zero_projection_reports_zero_not_missing() -> None:
    # UK maps to GB; a legitimate zero must come through as 0, not be dropped as missing -- the
    # bug a bare `or` in _figure_for would reintroduce for exactly the two remapped countries.
    handle = _responder(download=zip_of(build_nc(["UK"], [2050], [[0]])))
    uk = a_country("united_kingdom", "GB")

    result = await _adapter(handle).fetch(an_attribute(), [uk])

    assert _by_candidate(result.values)["country.united_kingdom"].payload.magnitude == Decimal(0)


async def test_a_country_absent_from_the_file_gets_no_value() -> None:
    result = await _adapter(_responder()).fetch(an_attribute(), FOUR_COUNTRIES)

    assert "country.malta" not in _by_candidate(result.values)
    assert not result.failures  # an absent country is coverage, not a failure


async def test_it_waits_for_a_job_that_is_not_ready_at_once() -> None:
    handle = _responder(execute_status="accepted", poll_statuses=("running", "successful"))

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.france"].payload.magnitude == Decimal(20)


async def test_several_model_files_in_the_zip_are_averaged_as_one_ensemble() -> None:
    cooler = build_nc(["DE", "EL", "FR"], [2050], [[10], [10], [10]])
    warmer = build_nc(["DE", "EL", "FR"], [2050], [[20], [20], [20]])
    handle = _responder(download=zip_of(cooler, warmer))

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(15)


async def test_a_bare_netcdf_download_not_in_a_zip_is_read() -> None:
    handle = _responder(download=build_nc(["DE", "EL", "FR"], [2050], [[17], [40], [20]]))

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(17)


async def test_no_token_is_a_clear_failure_not_a_crash() -> None:
    result = await _adapter(_responder(), token=None).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert len(result.failures) == 1
    assert "CDS_API_KEY" in result.failures[0].reason


async def test_the_token_is_sent_in_a_private_token_header() -> None:
    seen: list[httpx.Request] = []

    await _adapter(_responder(seen=seen)).fetch(an_attribute(), FOUR_COUNTRIES)

    assert seen and all(request.headers.get("PRIVATE-TOKEN") == "tok" for request in seen)


async def test_a_failed_job_becomes_a_failure() -> None:
    result = await _adapter(_responder(execute_status="failed")).fetch(
        an_attribute(), FOUR_COUNTRIES
    )

    assert result.values == ()
    assert "failed" in result.failures[0].reason


async def test_a_results_document_with_no_download_href_is_a_failure() -> None:
    result = await _adapter(_responder(results_doc={})).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "href" in result.failures[0].reason


async def test_an_unreadable_download_is_a_failure_not_a_crash() -> None:
    handle = _responder(download=b"country_name,year,value\nGermany,2050,15\n")

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "open" in result.failures[0].reason


async def test_it_answers_no_attribute_but_its_own() -> None:
    other = an_attribute(id="country.forest_cover")

    result = await _adapter(_responder()).fetch(other, FOUR_COUNTRIES)

    assert result.values == ()
    assert "no such attribute" in result.failures[0].reason


async def test_an_http_error_from_the_cds_becomes_a_failure() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="the data store is down")

    result = await _adapter(refuse).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "500" in result.failures[0].reason


async def test_a_job_that_never_finishes_times_out_rather_than_hanging() -> None:
    handle = _responder(execute_status="accepted", poll_statuses=("running", "running"))
    adapter = CopernicusAdapter(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), "tok", poll_seconds=0, max_polls=1
    )

    result = await adapter.fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "still" in result.failures[0].reason


async def test_a_zip_with_no_netcdf_inside_is_a_failure() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "no data here")
    handle = _responder(download=buffer.getvalue())

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "no NetCDF" in result.failures[0].reason


async def test_a_bare_href_on_the_results_document_is_accepted() -> None:
    handle = _responder(results_doc={"href": "https://download.test/result.zip"})

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(17)


async def test_a_location_on_the_results_document_is_accepted() -> None:
    handle = _responder(results_doc={"location": "https://download.test/result.zip"})

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(17)


async def test_a_quantity_attribute_with_no_unit_is_a_broken_catalog_not_a_failure() -> None:
    # A missing unit is the catalog's fault, so it raises loudly once rather than being filed 32
    # times as the CDS doing something wrong.
    with pytest.raises(ValueError, match="unit"):
        await _adapter(_responder()).fetch(an_attribute(quantity_parameters=None), FOUR_COUNTRIES)


async def test_it_builds_values_from_the_captured_nine_model_response() -> None:
    handle = _responder(download=(CAPTURED / "hot_days_nuts0_rcp45.zip").read_bytes())
    candidates = [
        a_country("cyprus", "CY"),
        a_country("germany", "DE"),
        a_country("united_kingdom", "GB"),  # GB in ISO, UK in NUTS
    ]

    result = await _adapter(handle).fetch(an_attribute(), candidates)

    by_candidate = _by_candidate(result.values)
    assert abs(by_candidate["country.cyprus"].payload.magnitude - Decimal("62.045405")) < Decimal(
        "0.001"
    )
    assert abs(by_candidate["country.germany"].payload.magnitude - Decimal("8.958066")) < Decimal(
        "0.001"
    )
    assert abs(
        by_candidate["country.united_kingdom"].payload.magnitude - Decimal("0.361019")
    ) < Decimal("0.001")
