"""The OECD as a `SourceAdapter`: one HTTP call per attribute, values out.

**Keyed on alpha-3**, which the candidate carries (migration `0440`). The response also holds
aggregates -- `OECD_REP`, `EU22OECD` -- which are looked up by nobody, because the adapter only
asks for codes its own candidates hold.

**Nothing is filled in.** Six of the 32 are not in Taxing Wages -- Romania, Bulgaria, Croatia,
Cyprus, Malta, Liechtenstein -- and they produce no value here. That gap travels to the ranking
as coverage until a source that does cover them is ranked behind this one.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    DataSourceId,
    Measurements,
    Ratio,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.oecd.manifest import BASE_URL, SERIES, OecdSeries
from starnest.data_sources.oecd.response import OecdError, figures

OECD = DataSourceId("oecd")


class OecdAdapter(SourceAdapter):
    """The legacy SDMX-JSON service, which is free, unauthenticated and answers a script."""

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._client = client
        self._base_url = base_url

    @property
    def data_source(self) -> DataSourceId:
        return OECD

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(SERIES)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        series = SERIES.get(attribute.id)
        if series is None:
            return Acquired(
                failures=(
                    _a_failure(
                        attribute.id,
                        f"the oecd publishes no series for {attribute.id} in this adapter",
                    ),
                )
            )
        try:
            by_area = figures(await self._get(series), series.selection)
        except httpx.HTTPStatusError as refused:
            return Acquired(failures=(_a_failure(attribute.id, _why(refused)),))
        except (httpx.HTTPError, OecdError) as unreachable:
            return Acquired(failures=(_a_failure(attribute.id, str(unreachable)),))
        return _values_from(by_area, series, attribute, candidates)

    async def _get(self, series: OecdSeries) -> object:
        response = await self._client.get(
            f"{self._base_url}/{series.dataflow}/", params={"format": "jsondata"}
        )
        response.raise_for_status()
        return response.json()


def _why(refused: httpx.HTTPStatusError) -> str:
    """What went wrong, in words a retry can act on.

    **OECD's Cloudflare front sometimes answers a script with a browser challenge** -- seen on
    2026-09-11, two days after the same request had returned data. It is not a fault in the
    request and not a withdrawn series, and "403 Forbidden" would send somebody looking for one.
    The header is Cloudflare's own marker for it (`docs/catalog-blockers.md` item 5).
    """
    if refused.response.headers.get("cf-mitigated") == "challenge":
        return (
            "the oecd's cloudflare front answered with a browser challenge instead of data, as it "
            "does intermittently for scripts; nothing is wrong with the request, and the figures "
            "already stored are untouched"
        )
    return str(refused)


def _values_from(
    by_area: dict[str, dict[str, Decimal]],
    series: OecdSeries,
    attribute: Attribute,
    candidates: Sequence[Candidate],
) -> Acquired:
    measuring = Measurements(attribute=attribute, data_source=OECD, retrieved=datetime.now(UTC))
    basis = _the_basis_of(attribute)

    values: list[Value] = []
    failures: list[AcquisitionFailure] = []
    for candidate in candidates:
        if candidate.country_code_alpha3 is None:
            failures.append(
                _a_failure(
                    attribute.id,
                    "the candidate carries no alpha-3 country code, which is the only form the "
                    "oecd answers to",
                    candidate=str(candidate.id),
                )
            )
            continue
        by_period = by_area.get(str(candidate.country_code_alpha3), {})
        if not by_period:
            # Not a failure. The OECD does not cover this country, and the gap must reach the
            # ranking as coverage.
            continue
        period = max(by_period)
        try:
            values.append(
                measuring.figure(
                    candidate=candidate,
                    period=_whole_year(period),
                    payload=Ratio(value=by_period[period], basis=basis),
                    quote=f"OECD {series.dataflow} {period}: {by_period[period]}",
                )
            )
        except ValidationError as refused:
            failures.append(
                _a_failure(attribute.id, _the_reason(refused), candidate=str(candidate.id))
            )
    return Acquired(values=tuple(values), failures=tuple(failures))


def _the_basis_of(attribute: Attribute) -> str:
    """The basis the catalog declares, resolved once. A Ratio with none is a broken catalog."""
    if attribute.ratio_parameters is None:
        raise ValueError(f"{attribute.id} is a Ratio and the catalog gives it no basis")
    return attribute.ratio_parameters.basis


def _whole_year(period: str) -> ReferencePeriod:
    year = int(period)
    return ReferencePeriod(start=date(year, 1, 1), end=date(year, 12, 31))


def _the_reason(refused: ValidationError) -> str:
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if original is not None else str(first.get("msg", refused))


def _a_failure(
    attribute: AttributeId, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=candidate)
