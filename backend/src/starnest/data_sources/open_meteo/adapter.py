"""Open-Meteo's archive: one national temperature per country, from its largest places.

`devplan.md` D4, `reqs.md` Q210. Open-Meteo answers for a point on the map. A country's figure
is the **population-weighted mean over its five largest places**, which the catalog declares
(`population_centre`, from GeoNames) -- where people live, which is where the household would.

**One settled year**, not a decade. The free tier counts a request as one call per place per two
weeks of data, so ten years for 160 places would be ~42,000 calls against a limit of 10,000 a
day. One year is ~4,200. Year-to-year swings in a national mean (about ±1 °C) are small beside
the differences between countries (about 17 °C), so a year ranks climates faithfully while
reading as a slightly noisy absolute figure; the quote names the year.

**Medium confidence.** ERA5 reanalysis matches the recorders closely for temperature, but
weighting five points into a nation is this application's arithmetic, and a derived figure is
downgraded a step (`reqs.md` 5.7).

**Paced, not rushed.** Each request waits its share of a minute under the free tier's limit, so
a full run takes some minutes rather than tripping a 429 halfway through.
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import httpx

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    CatalogStore,
    ConfidenceLevel,
    DataSourceId,
    PopulationCentre,
    Quantity,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.open_meteo.manifest import (
    BASE_URL,
    CALLS_PER_MINUTE,
    DAYS_PER_CALL,
    SETTLING_DAYS,
    VARIABLES,
)
from starnest.data_sources.open_meteo.response import OpenMeteoError, daily_series

OPEN_METEO = DataSourceId("open_meteo")


class OpenMeteoAdapter(SourceAdapter):
    """The historical weather archive, free and unauthenticated, measured at declared places."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        places: CatalogStore,
        *,
        base_url: str = BASE_URL,
        today: Callable[[], date] = lambda: datetime.now(UTC).date(),
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client = client
        self._places = places
        self._base_url = base_url
        self._today = today
        self._pause = pause

    @property
    def data_source(self) -> DataSourceId:
        return OPEN_METEO

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(VARIABLES)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        variable = VARIABLES.get(attribute.id)
        if variable is None:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"open-meteo answers no variable for {attribute.id} in this adapter",
                    ),
                )
            )
        unit = _the_unit_of(attribute)
        year = (self._today() - timedelta(days=SETTLING_DAYS)).year - 1
        places_of: dict[str, list[PopulationCentre]] = {}
        for place in await self._places.read_population_centres():
            places_of.setdefault(str(place.candidate), []).append(place)

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        asked = False
        for candidate in candidates:
            places = places_of.get(str(candidate.id))
            if not places:
                failures.append(
                    _a_failure(
                        attribute.id, candidate, "the catalog declares no places to measure it at"
                    )
                )
                continue
            if asked:
                await self._pause(_seconds_for(len(places)))
            asked = True
            try:
                series = await self._daily(places, variable, year)
            except httpx.HTTPStatusError as refused:
                failures.append(_a_failure(attribute.id, candidate, _why(refused)))
                continue
            except (httpx.HTTPError, OpenMeteoError) as unreadable:
                failures.append(_a_failure(attribute.id, candidate, str(unreadable)))
                continue
            value = _the_national_figure(places, series, attribute=attribute, unit=unit, year=year)
            if value is None:
                failures.append(
                    _a_failure(attribute.id, candidate, f"no place has a complete year of {year}")
                )
                continue
            values.append(value)
        return Acquired(values=tuple(values), failures=tuple(failures))

    async def _daily(
        self, places: Sequence[PopulationCentre], variable: str, year: int
    ) -> list[list[Decimal | None]]:
        response = await self._client.get(
            self._base_url,
            params={
                "latitude": ",".join(str(place.latitude) for place in places),
                "longitude": ",".join(str(place.longitude) for place in places),
                "start_date": f"{year}-01-01",
                "end_date": f"{year}-12-31",
                "daily": variable,
                "timezone": "GMT",
            },
        )
        response.raise_for_status()
        return daily_series(response.json(), variable, len(places))


def _the_national_figure(
    places: Sequence[PopulationCentre],
    series: Sequence[Sequence[Decimal | None]],
    *,
    attribute: Attribute,
    unit: str,
    year: int,
) -> Value | None:
    """The population-weighted mean over the places with a complete year, or None if none has.

    A place with any missing day is left out rather than averaged over the days it has: a year
    missing its winter is not that place's annual mean.
    """
    complete = [
        (place, sum(readings, Decimal(0)) / len(readings))  # type: ignore[arg-type]
        for place, readings in zip(places, series, strict=True)
        if readings and all(reading is not None for reading in readings)
    ]
    if not complete:
        return None
    people = sum(place.population for place, _ in complete)
    figure = sum((mean * place.population for place, mean in complete), Decimal(0)) / people
    figure = figure.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    workings = ", ".join(
        f"{place.name} {mean.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)} "
        f"({place.population:,})"
        for place, mean in complete
    )
    return Value(
        candidate=places[0].candidate,
        attribute=attribute.id,
        value_type=attribute.value_type,
        data_source=OPEN_METEO,
        reference_period=ReferencePeriod.covering_year(year),
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.MEDIUM,
        payload=Quantity(magnitude=figure, unit=unit),
        quote=f"Open-Meteo archive (ERA5) {year}, weighted by population: {workings} = {figure}",
    )


def _seconds_for(places: int) -> float:
    """This request's share of a minute: a year for each place, at the free tier's rate."""
    calls = places * 365 / DAYS_PER_CALL
    return calls / CALLS_PER_MINUTE * 60


def _the_unit_of(attribute: Attribute) -> str:
    """The catalog's unit. A Quantity without one is a broken catalog, raised once and loudly
    rather than recorded thirty-two times as though Open-Meteo had done something wrong."""
    if attribute.quantity_parameters is None:
        raise ValueError(f"{attribute.id} is a Quantity and the catalog gives it no unit")
    return str(attribute.quantity_parameters.unit)


def _why(refused: httpx.HTTPStatusError) -> str:
    """Open-Meteo explains a refusal in a `reason` field; that sentence is worth more than a
    status code, especially "request limit exceeded"."""
    try:
        reason = refused.response.json().get("reason")
    except ValueError:
        reason = None
    return f"{refused.response.status_code}: {reason}" if reason else str(refused)


def _a_failure(attribute: AttributeId, candidate: Candidate, reason: str) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=str(candidate.id))
