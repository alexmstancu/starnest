"""The IMF as a `SourceAdapter`: one HTTP call per attribute, values out.

**A forecast, and it says so.** Every other adapter here reports what a country measured; this
one reports what the IMF expects it to. The reference period is the year forecast, not the year
of the forecast, so a 2027 figure is stored against 2027 and reads as being about 2027 -- which
is the same rule `reqs.md` 3.6 applies to everything else and happens to be the honest one here
too.

**Keyed on alpha-3, which the candidate already carries** (migration `0440`).

**Nothing is filled in.** A country with no projection for the year asked produces no value:
not the nearest year, not the euro-area figure. That gap travels to the ranking as coverage.
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
    Quantity,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.imf.manifest import BASE_URL, INDICATORS, YEARS_AHEAD
from starnest.data_sources.imf.response import ImfError, Projection, projections

IMF = DataSourceId("imf")


class ImfAdapter(SourceAdapter):
    """The DataMapper API, which is free, unauthenticated and returns JSON."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        base_url: str = BASE_URL,
        today: date | None = None,
    ) -> None:
        self._client = client
        self._base_url = base_url
        # Injected so a test can pin the forecast year. Left alone it is the real clock, because
        # which year counts as "next" is a fact about when the fetch happened.
        self._today = today

    @property
    def data_source(self) -> DataSourceId:
        return IMF

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
                        reason=f"the imf publishes no indicator for {attribute.id} in this adapter",
                    ),
                )
            )
        try:
            document = await self._get(indicator)
            reported = projections(document, indicator)
        except httpx.HTTPStatusError as refused:
            return Acquired(failures=(_a_failure(attribute.id, str(refused)),))
        except (httpx.HTTPError, ImfError) as unreachable:
            return Acquired(failures=(_a_failure(attribute.id, str(unreachable)),))
        return self._values_from(reported, attribute, candidates)

    async def _get(self, indicator: str) -> object:
        """The whole indicator, because the API returns it whatever is asked for.

        Naming countries in the path is documented and ignored: a request for four comes back
        with every economy the IMF publishes. Asking for all of it is therefore honest about
        what arrives, and one request rather than thirty-two.
        """
        response = await self._client.get(f"{self._base_url}/{indicator}")
        response.raise_for_status()
        return response.json()

    def _values_from(
        self,
        reported: dict[str, dict[int, Projection]],
        attribute: Attribute,
        candidates: Sequence[Candidate],
    ) -> Acquired:
        retrieved = datetime.now(UTC)
        forecast_year = (self._today or date.today()).year + YEARS_AHEAD
        unit = _the_unit_of(attribute)

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        for candidate in candidates:
            if candidate.country_code_alpha3 is None:
                failures.append(
                    _a_failure(
                        attribute.id,
                        "the candidate carries no alpha-3 country code, which is the only form "
                        "the imf answers to",
                        candidate=str(candidate.id),
                    )
                )
                continue
            projected = reported.get(str(candidate.country_code_alpha3), {}).get(forecast_year)
            if projected is None:
                # Not a failure. The IMF forecasts this far ahead for most economies and not
                # all, and a missing forecast must reach the ranking as coverage.
                continue
            try:
                values.append(
                    _a_value(
                        projected,
                        unit=unit,
                        attribute=attribute,
                        candidate=candidate,
                        retrieved=retrieved,
                    )
                )
            except ValidationError as refused:
                failures.append(
                    _a_failure(attribute.id, _the_reason(refused), candidate=str(candidate.id))
                )
        return Acquired(values=tuple(values), failures=tuple(failures))


def _the_unit_of(attribute: Attribute) -> str:
    """The unit the catalog declares, resolved once for the whole fetch.

    A `Quantity` attribute with no unit is a broken catalog rather than a failed fetch, so it
    raises loudly and once instead of being recorded thirty-two times.
    """
    if attribute.quantity_parameters is None:
        raise ValueError(f"{attribute.id} is a Quantity and the catalog gives it no unit")
    return attribute.quantity_parameters.unit


def _the_reason(refused: ValidationError) -> str:
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if original is not None else str(first.get("msg", refused))


def _a_failure(
    attribute: AttributeId, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=candidate)


def _a_value(
    projected: Projection,
    *,
    unit: str,
    attribute: Attribute,
    candidate: Candidate,
    retrieved: datetime,
) -> Value:
    return Value(
        candidate=candidate.id,
        attribute=attribute.id,
        value_type=attribute.value_type,
        data_source=IMF,
        # The year forecast, not the year of the forecast. A projection for 2027 describes 2027.
        reference_period=ReferencePeriod(
            start=date(projected.year, 1, 1), end=date(projected.year, 12, 31)
        ),
        retrieval_date=retrieved,
        # A forecast is not a measurement, whoever made it. `medium` says so without pretending
        # the IMF's is unreliable (`reqs.md` 5.7).
        confidence_level=ConfidenceLevel.MEDIUM,
        payload=Quantity(magnitude=projected.figure, unit=unit),
        quote=f"IMF World Economic Outlook projection for {projected.year}: {projected.figure}%",
    )
