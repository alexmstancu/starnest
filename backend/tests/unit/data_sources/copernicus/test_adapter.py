"""The CDS job protocol becoming stored values, driven through a stubbed transport.

The four HTTP steps -- submit, poll, read the result, download -- are simulated with
`httpx.MockTransport`, so the protocol is exercised without a CDS account. The CSV bytes are a
constructed sample in the documented long format; what the first live fetch confirms is the real
column names and the result-document shape, each pinned in one place that fails loudly.
"""

import io
import zipfile
from collections.abc import Callable
from datetime import date
from decimal import Decimal

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

COUNTRY = {"id": "country", "depth_order": 1}
HEAT = "country.projected_summer_heat_days"

SAMPLE_CSV = (
    "nuts_id,year,value\n"
    "DE,2041,15\n"
    "DE,2055,17\n"
    "DE,2070,19\n"
    "EL,2050,40\n"  # Greece is EL in NUTS, GR in ISO
    "FR,2050,20\n"
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
    a_country("greece", "GR"),
    a_country("france", "FR"),
    a_country("malta", "MT"),  # absent from the sample file
]


def _responder(
    *,
    csv_payload: bytes = SAMPLE_CSV.encode(),
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
        return httpx.Response(200, content=csv_payload)

    return handle


def _adapter(
    handle: Callable[[httpx.Request], httpx.Response], *, token: str | None = "tok"
) -> CopernicusAdapter:
    return CopernicusAdapter(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), token, poll_seconds=0
    )


def _by_candidate(values: tuple) -> dict:
    return {str(value.candidate): value for value in values}


def _zipped(csv_text: str, name: str = "result.csv") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, csv_text)
    return buffer.getvalue()


async def test_it_submits_reads_and_builds_a_quantity_per_country() -> None:
    result = await _adapter(_responder()).fetch(an_attribute(), FOUR_COUNTRIES)

    by_candidate = _by_candidate(result.values)
    germany = by_candidate["country.germany"]
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


async def test_a_country_absent_from_the_file_gets_no_value() -> None:
    result = await _adapter(_responder()).fetch(an_attribute(), FOUR_COUNTRIES)

    assert "country.malta" not in _by_candidate(result.values)
    assert not result.failures  # an absent country is coverage, not a failure


async def test_it_waits_for_a_job_that_is_not_ready_at_once() -> None:
    handle = _responder(execute_status="accepted", poll_statuses=("running", "successful"))

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.france"].payload.magnitude == Decimal(20)


async def test_a_zip_asset_is_unzipped_and_read() -> None:
    handle = _responder(csv_payload=_zipped(SAMPLE_CSV))

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
    assert result.failures


async def test_an_unexpected_csv_shape_is_a_failure_not_a_crash() -> None:
    handle = _responder(csv_payload=b"country_name,year,value\nGermany,2050,15\n")

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "region" in result.failures[0].reason


async def test_it_answers_no_attribute_but_its_own() -> None:
    other = an_attribute(id="country.forest_cover")

    result = await _adapter(_responder()).fetch(other, FOUR_COUNTRIES)

    assert result.values == ()
    assert result.failures


async def test_an_http_error_from_the_cds_becomes_a_failure() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="the data store is down")

    result = await _adapter(refuse).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert result.failures


async def test_a_job_that_never_finishes_times_out_rather_than_hanging() -> None:
    handle = _responder(execute_status="accepted", poll_statuses=("running", "running"))
    adapter = CopernicusAdapter(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), "tok", poll_seconds=0, max_polls=1
    )

    result = await adapter.fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert "still" in result.failures[0].reason


async def test_a_zip_with_no_csv_inside_is_a_failure() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "no data here")
    handle = _responder(csv_payload=buffer.getvalue())

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert result.values == ()
    assert result.failures


async def test_an_ensemble_split_across_several_csv_members_is_read_as_one() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("member_1.csv", "nuts_id,year,value\nDE,2050,10\n")
        archive.writestr("member_2.csv", "nuts_id,year,value\nDE,2050,20\n")
    handle = _responder(csv_payload=buffer.getvalue())

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(15)


async def test_a_bare_href_on_the_results_document_is_accepted() -> None:
    handle = _responder(results_doc={"href": "https://download.test/result.csv"})

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(17)


async def test_a_location_on_the_results_document_is_accepted() -> None:
    handle = _responder(results_doc={"location": "https://download.test/result.csv"})

    result = await _adapter(handle).fetch(an_attribute(), FOUR_COUNTRIES)

    assert _by_candidate(result.values)["country.germany"].payload.magnitude == Decimal(17)


async def test_a_quantity_attribute_with_no_unit_is_a_broken_catalog_not_a_failure() -> None:
    # A missing unit is the catalog's fault, so it raises loudly once rather than being filed 32
    # times as the CDS doing something wrong.
    with pytest.raises(ValueError, match="unit"):
        await _adapter(_responder()).fetch(an_attribute(quantity_parameters=None), FOUR_COUNTRIES)
