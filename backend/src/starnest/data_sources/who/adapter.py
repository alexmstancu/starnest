"""WHO as a `SourceAdapter`: one HTTP call per attribute, values out.

**The whole indicator arrives in one response** -- every country, every year, every aggregate,
about three megabytes for the UHC series. There is no filter worth sending: WHO's OData accepts
one, but the series is small enough that a filtered request would trade the newest-year-per-
country logic for bytes we can afford, and that is the trade the Eurostat adapter already
refused for a better reason.

**Keyed on alpha-3, which the candidate already carries.** Migration `0440` put ISO's other
form on the candidate rather than a lookup table in here, because WHO is the first of four
sources that speak it and one table written four times is three chances to get it wrong.

**Nothing is filled in.** A country WHO has no figure for produces no value: no zero, no
regional average standing in for it. Liechtenstein is that country here, as it is at Eurostat,
and its gap travels to the ranking as coverage.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime

import httpx
from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    DataSourceId,
    Index,
    IndexParameters,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.who.manifest import BASE_URL, INDICATORS
from starnest.data_sources.who.response import Reading, WhoError, readings

WHO = DataSourceId("who")


class WhoAdapter(SourceAdapter):
    """The Global Health Observatory, which is free, unauthenticated and returns OData JSON."""

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._client = client
        self._base_url = base_url

    @property
    def data_source(self) -> DataSourceId:
        return WHO

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(INDICATORS)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        indicator = INDICATORS.get(attribute.id)
        if indicator is None:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"the global health observatory publishes no indicator for "
                        f"{attribute.id} in this adapter",
                    ),
                )
            )
        try:
            reported = readings(await self._get(indicator))
        except httpx.HTTPStatusError as refused:
            return Acquired(failures=(_a_failure(attribute.id, str(refused)),))
        except (httpx.HTTPError, WhoError) as unreachable:
            return Acquired(failures=(_a_failure(attribute.id, str(unreachable)),))
        return self._values_from(reported, attribute, candidates)

    async def _get(self, indicator: str) -> object:
        response = await self._client.get(f"{self._base_url}/{indicator}")
        response.raise_for_status()
        return response.json()

    def _values_from(
        self,
        reported: Sequence[Reading],
        attribute: Attribute,
        candidates: Sequence[Candidate],
    ) -> Acquired:
        retrieved = datetime.now(UTC)
        bounds = _the_scale_of(attribute)
        newest = _the_newest_year_per_country(reported)

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        for candidate in candidates:
            if candidate.country_code_alpha3 is None:
                failures.append(
                    _a_failure(
                        attribute.id,
                        "the candidate carries no alpha-3 country code, which is the only form "
                        "the global health observatory answers to",
                        candidate=str(candidate.id),
                    )
                )
                continue
            reading = newest.get(str(candidate.country_code_alpha3))
            if reading is None:
                # Not a failure. WHO simply has nothing for this country, which must reach the
                # ranking as coverage rather than as an error somebody has to triage.
                continue
            try:
                values.append(
                    _a_value(
                        reading,
                        bounds=bounds,
                        attribute=attribute,
                        candidate=candidate,
                        retrieved=retrieved,
                    )
                )
            except ValidationError as outside_its_scale:
                failures.append(
                    _a_failure(
                        attribute.id,
                        _the_reason(outside_its_scale),
                        candidate=str(candidate.id),
                    )
                )
        return Acquired(values=tuple(values), failures=tuple(failures))


def _the_newest_year_per_country(reported: Sequence[Reading]) -> dict[str, Reading]:
    """Each country's own latest figure, decided per country.

    Countries report to WHO on their own schedules, so taking the series' newest year as one
    number for everybody would drop whoever had not filed. The reference period records which
    year each figure actually is, so an old one is visibly old rather than silently current.
    """
    newest: dict[str, Reading] = {}
    for reading in reported:
        held = newest.get(reading.country)
        if held is None or reading.year > held.year:
            newest[reading.country] = reading
    return newest


def _the_scale_of(attribute: Attribute) -> IndexParameters:
    """The bounds the catalog publishes this attribute on, resolved once for the whole fetch.

    An `Index` attribute with no bounds is a broken catalog rather than a failed fetch, so it
    raises loudly and once instead of being recorded thirty-two times as though WHO had done
    something wrong.
    """
    bounds = attribute.index_parameters
    if bounds is None:
        raise ValueError(f"{attribute.id} is an Index and the catalog gives it no scale")
    return bounds


def _the_reason(refused: ValidationError) -> str:
    """The domain error out of Pydantic's wrapper, so a failure reads as a sentence."""
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if original is not None else str(first.get("msg", refused))


def _a_failure(
    attribute: AttributeId, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=candidate)


def _a_value(
    reading: Reading,
    *,
    bounds: IndexParameters,
    attribute: Attribute,
    candidate: Candidate,
    retrieved: datetime,
) -> Value:
    return Value(
        candidate=candidate.id,
        attribute=attribute.id,
        value_type=attribute.value_type,
        data_source=WHO,
        reference_period=ReferencePeriod(
            start=date(reading.year, 1, 1), end=date(reading.year, 12, 31)
        ),
        retrieval_date=retrieved,
        confidence_level=ConfidenceLevel.HIGH,
        payload=Index(
            value=reading.figure,
            provider=bounds.provider,
            scale_min=bounds.scale_min,
            scale_max=bounds.scale_max,
        ),
        quote=f"WHO UHC Service Coverage Index {reading.year}: {reading.figure}",
    )
