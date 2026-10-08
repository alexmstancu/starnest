"""The Copernicus Climate Data Store as a `SourceAdapter`: one projection, one figure per country.

**Unlike the other structured sources, the CDS is an async job queue, not a GET.** A request is
submitted, the server prepares it, and the result is downloaded when ready -- so this adapter
submits, polls the job, reads the result's download link, fetches the (zipped) regional NetCDF,
and hands the `.nc` file bytes to `response.py`. The protocol is the OGC-API-Processes shape the
CDS publishes: `POST /processes/{dataset}/execute`, `GET /jobs/{id}`, `GET /jobs/{id}/results`,
authenticated with a free Personal Access Token in a `PRIVATE-TOKEN` header. It is free, so
`costs_money` stays False.

**Free, but authenticated.** Without a token the source cannot be asked, so a run records a clear
failure for the attribute and moves on -- the same shape as any source being unreachable, and the
day a token is set in `.env` a run fills it. The adapter is still registered without one, so the
attribute stays *covered* (the LLM fallback must not guess a climate projection it was never meant
to), and the catalog and the adapters still agree at boot.

**Nothing is filled in.** A country the regional files have no figure for produces no value: no
zero, no neighbour's. That gap travels to the ranking as coverage (`reqs.md` 5.3).

**Confirmed against the live CDS on 2026-10-08.** The request (`manifest.py`) returns one NetCDF
file per EURO-CORDEX model run (nine, on that date) in a single zip; `response.py` reads them with
`netCDF4` and averages across models and horizon years. Each step raises loudly rather than
guessing when the API answers in a shape it does not recognise.
"""

import asyncio
import io
import zipfile
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any, Final

import httpx

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    DataSourceId,
    Measurements,
    Quantity,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, SourceAdapter
from starnest.data_sources.copernicus.manifest import (
    BASE_URL,
    DATASET,
    ENSEMBLE_PROVENANCE,
    HORIZON_END_YEAR,
    HORIZON_START_YEAR,
    INDICATORS,
    SCENARIO_PROVENANCE,
    THRESHOLD_PROVENANCE,
)
from starnest.data_sources.copernicus.response import CopernicusError, heat_days_by_country
from starnest.data_sources.transport import a_failure

COPERNICUS = DataSourceId("copernicus")

NUTS_TO_ISO: Final = {"EL": "GR", "UK": "GB"}
"""The two NUTS0 codes that are not the ISO alpha-2 our candidates carry: Eurostat writes Greece
`EL` and the United Kingdom `UK`. Every other NUTS0 code is the ISO code unchanged."""

_TERMINAL_STATUSES: Final = {"successful", "failed", "dismissed"}


class CopernicusAdapter(SourceAdapter):
    """The CDS retrieve API, for the EURO-CORDEX hot-days projection at country level."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str | None,
        *,
        base_url: str = BASE_URL,
        poll_seconds: float = 2.0,
        max_polls: int = 180,
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        # The job can take minutes; the defaults wait up to six, which a run's own failure path
        # turns into a retryable failure rather than a hang. Tests set poll_seconds to 0.
        self._poll_seconds = poll_seconds
        self._max_polls = max_polls

    @property
    def data_source(self) -> DataSourceId:
        return COPERNICUS

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(INDICATORS)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        request = INDICATORS.get(attribute.id)
        if request is None:
            return Acquired(
                failures=(a_failure(attribute.id, "the CDS adapter answers no such attribute"),)
            )
        if self._api_key is None:
            return Acquired(
                failures=(
                    a_failure(
                        attribute.id,
                        "no CDS Personal Access Token configured (set CDS_API_KEY in .env); "
                        "the Copernicus projection cannot be fetched without one",
                    ),
                )
            )

        try:
            nc_files = await self._regional_files(dict(request))
            by_country = heat_days_by_country(
                nc_files, horizon_start=HORIZON_START_YEAR, horizon_end=HORIZON_END_YEAR
            )
        except (httpx.HTTPError, CopernicusError) as unavailable:
            return Acquired(failures=(a_failure(attribute.id, str(unavailable)),))

        return self._values_from(by_country, attribute, candidates)

    def _values_from(
        self, by_country: dict[str, Any], attribute: Attribute, candidates: Sequence[Candidate]
    ) -> Acquired:
        if attribute.quantity_parameters is None:
            # A broken catalog, not a failed fetch: raised once and loudly rather than recorded 32
            # times as the CDS's fault (the argument `world_bank` makes for its Index bounds).
            raise ValueError(f"{attribute.id} is a Quantity and the catalog gives it no unit")
        unit = attribute.quantity_parameters.unit
        measuring = Measurements(
            attribute=attribute,
            data_source=COPERNICUS,
            retrieved=datetime.now(UTC),
            # A model projection, not an observation. Medium is the honest default; the quote
            # carries the scenario, threshold and ensemble so a reader weighs it themselves.
            confidence_level=ConfidenceLevel.MEDIUM,
        )
        values: list[Value] = []
        for candidate in candidates:
            iso = candidate.country_code
            mean = _figure_for(iso, by_country)
            if mean is None:
                # The regional files simply have nothing for this country (sub-grid-cell
                # micro-states may drop out): coverage, not an error.
                continue
            values.append(
                measuring.figure(
                    candidate=candidate,
                    payload=Quantity(magnitude=mean, unit=unit),
                    period=ReferencePeriod(
                        start=date(HORIZON_START_YEAR, 1, 1), end=date(HORIZON_END_YEAR, 12, 31)
                    ),
                    quote=(
                        f"{THRESHOLD_PROVENANCE}, {HORIZON_START_YEAR}-{HORIZON_END_YEAR} "
                        f"{ENSEMBLE_PROVENANCE}, {SCENARIO_PROVENANCE}: {mean}"
                    ),
                )
            )
        return Acquired(values=tuple(values))

    async def _regional_files(self, inputs: dict[str, Any]) -> list[bytes]:
        """Submit the job, wait for it, and return the regional NetCDF files (one per model run).

        Each step raises `CopernicusError` with a sentence when the API answers in a shape this
        does not recognise, so an unverified assumption stops here rather than downstream.
        """
        submitted = await self._post(f"/processes/{DATASET}/execute", {"inputs": inputs})
        job_id = submitted.get("jobID") or submitted.get("jobId")
        if not job_id:
            raise CopernicusError(f"the CDS accepted no job: {submitted}")

        status = submitted.get("status", "accepted")
        polls = 0
        while status not in _TERMINAL_STATUSES:
            if polls >= self._max_polls:
                raise CopernicusError(
                    f"the CDS job {job_id} was still '{status}' after {polls} checks"
                )
            await asyncio.sleep(self._poll_seconds)
            polls += 1
            status = (await self._get_json(f"/jobs/{job_id}")).get("status", status)

        if status != "successful":
            raise CopernicusError(f"the CDS job {job_id} ended '{status}'")

        href = _download_href(await self._get_json(f"/jobs/{job_id}/results"))
        return _nc_files(await self._get_bytes(href))

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(
            f"{self._base_url}{path}", json=body, headers=self._headers()
        )
        response.raise_for_status()
        return response.json()

    async def _get_json(self, path_or_url: str) -> dict[str, Any]:
        response = await self._client.get(self._absolute(path_or_url), headers=self._headers())
        response.raise_for_status()
        return response.json()

    async def _get_bytes(self, url: str) -> bytes:
        response = await self._client.get(self._absolute(url), headers=self._headers())
        response.raise_for_status()
        return response.content

    def _headers(self) -> dict[str, str]:
        # The token authenticates every call. Never logged: it reaches no failure message, which
        # carry only the server's own words.
        return {"PRIVATE-TOKEN": self._api_key} if self._api_key else {}

    def _absolute(self, path_or_url: str) -> str:
        if path_or_url.startswith("http"):
            return path_or_url
        return f"{self._base_url}{path_or_url}"


def _figure_for(iso: str | None, by_country: dict[str, Any]) -> Any:
    """The country's mean, matching our ISO alpha-2 to the file's NUTS0 code.

    A candidate with no country code (there are none at country level, but the type allows it)
    cannot be matched and is left absent. Membership is tested with `in`, not truthiness, so a
    legitimate zero -- a country the projection gives no hot days -- is returned as 0, not dropped
    as missing (which a bare `or` would do for the EL/UK-remapped countries).
    """
    if iso is None:
        return None
    nuts = {value: key for key, value in NUTS_TO_ISO.items()}.get(iso, iso)
    for key in (nuts.upper(), iso.upper()):
        if key in by_country:
            return by_country[key]
    return None


def _download_href(results: dict[str, Any]) -> str:
    """The URL of the prepared asset in a results document.

    The CDS wraps it as an `asset.value.href`; older shapes put a bare `href` on the result or a
    `location`. All three are tried, and a document with none raises -- the one place the result
    schema is pinned.
    """
    asset = results.get("asset")
    if isinstance(asset, dict):
        value = asset.get("value")
        if isinstance(value, dict) and value.get("href"):
            return str(value["href"])
    for key in ("href", "location"):
        if results.get(key):
            return str(results[key])
    raise CopernicusError(f"the CDS results carried no download href: {results}")


def _nc_files(payload: bytes) -> list[bytes]:
    """The NetCDF member bytes, whether the asset is a zip of them (as regional downloads are) or
    a bare `.nc`. A zip with no `.nc` inside raises, so an empty or wrong-shaped result stops here
    rather than downstream."""
    if payload[:2] != b"PK":
        return [payload]
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith(".nc")]
        if not members:
            raise CopernicusError("the CDS asset was a zip with no NetCDF (.nc) inside")
        return [archive.read(name) for name in sorted(members)]
