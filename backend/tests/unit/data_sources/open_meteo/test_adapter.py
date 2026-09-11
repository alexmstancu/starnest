"""Open-Meteo's archive becoming one national temperature per country (D4, Q210).

Driven through a stub transport answering with a response captured from the live API: Portugal's
five largest places, 2025. What these tests hold is the method the household chose -- the
population-weighted mean over the places the catalog declares -- and the free tier's terms,
which a run must respect rather than trip over.
"""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    PopulationCentre,
    QuantityParameters,
    ValueType,
)
from starnest.data_sources.open_meteo import OpenMeteoAdapter

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}
TEMPERATURE = "country.avg_annual_temperature"
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")
IN_SEPTEMBER = date(2026, 9, 11)

PORTUGALS_PLACES = tuple(
    PopulationCentre(
        candidate="country.portugal",
        name=name,
        latitude=Decimal(latitude),
        longitude=Decimal(longitude),
        population=population,
    )
    for name, latitude, longitude, population in (
        ("Lisbon", "38.72509", "-9.14980", 517802),
        ("Porto", "41.14850", "-8.61097", 252687),
        ("Braga", "41.55140", "-8.42311", 193324),
        ("Amadora", "38.75382", "-9.23083", 178858),
        ("Coimbra", "40.20686", "-8.41996", 140796),
    )
)


def temperature() -> Attribute:
    return Attribute(
        id=TEMPERATURE,
        name="Average annual temperature",
        level="country",
        value_type=ValueType.QUANTITY,
        pillar="climate",
        quantity_parameters=QuantityParameters(unit="celsius"),
    )


class Places:
    """Just enough `CatalogStore` for the adapter: the places it measures at."""

    def __init__(self, places: tuple[PopulationCentre, ...] = PORTUGALS_PLACES) -> None:
        self._places = places

    async def read_population_centres(self) -> tuple[PopulationCentre, ...]:
        return self._places


class Pauses:
    def __init__(self) -> None:
        self.seconds: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.seconds.append(seconds)


def captured() -> list:
    return json.loads((CAPTURED / "portugal_2025.json").read_text())


def an_adapter(
    body: object = None,
    *,
    status: int = 200,
    places: Places | None = None,
    today: date = IN_SEPTEMBER,
    pauses: Pauses | None = None,
    requests: list[httpx.Request] | None = None,
) -> OpenMeteoAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return httpx.Response(status, json=captured() if body is None else body)

    return OpenMeteoAdapter(
        httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        places or Places(),  # type: ignore[arg-type]
        today=lambda: today,
        pause=pauses or Pauses(),
    )


def the_mean_of(location: dict) -> Decimal:
    readings = [Decimal(str(t)) for t in location["daily"]["temperature_2m_mean"]]
    return sum(readings, Decimal(0)) / len(readings)


class TestTheNationalFigure:
    async def test_it_is_the_population_weighted_mean_of_the_places(self) -> None:
        """Lisbon counts for 517,802 people and Coimbra for 140,796."""
        (value,) = (await an_adapter().fetch(temperature(), [PORTUGAL])).values

        weights = [place.population for place in PORTUGALS_PLACES]
        expected = sum(
            (
                the_mean_of(location) * weight
                for location, weight in zip(captured(), weights, strict=True)
            ),
            Decimal(0),
        ) / sum(weights)
        assert value.payload.magnitude == pytest.approx(expected, abs=Decimal("0.01"))

    async def test_it_is_a_quantity_in_the_unit_the_catalog_declares(self) -> None:
        (value,) = (await an_adapter().fetch(temperature(), [PORTUGAL])).values

        assert value.payload.unit == "celsius"
        assert value.data_source == "open_meteo"

    async def test_it_is_medium_confidence(self) -> None:
        """Reanalysis is a measurement; weighting five points into a nation is ours, and a
        derived figure is downgraded a step (`reqs.md` 5.7)."""
        (value,) = (await an_adapter().fetch(temperature(), [PORTUGAL])).values

        assert value.confidence_level is ConfidenceLevel.MEDIUM

    async def test_it_describes_the_year_it_was_measured_over(self) -> None:
        (value,) = (await an_adapter().fetch(temperature(), [PORTUGAL])).values

        assert value.reference_period.start == date(2025, 1, 1)
        assert value.reference_period.end == date(2025, 12, 31)

    async def test_the_quote_names_every_place_with_its_weight(self) -> None:
        (value,) = (await an_adapter().fetch(temperature(), [PORTUGAL])).values

        assert value.quote is not None
        assert value.quote.startswith("Open-Meteo archive (ERA5) 2025, weighted by population:")
        assert all(place.name in value.quote for place in PORTUGALS_PLACES)
        assert "517,802" in value.quote


class TestWhichYear:
    async def test_the_newest_year_whose_reanalysis_is_final(self) -> None:
        """ERA5 is final two to three months after the fact. In February, last year is still
        preliminary, so the year before it is the newest settled one."""
        requests: list[httpx.Request] = []

        await an_adapter(today=date(2026, 2, 1), requests=requests).fetch(temperature(), [PORTUGAL])

        assert requests[0].url.params["start_date"] == "2024-01-01"
        assert requests[0].url.params["end_date"] == "2024-12-31"

    async def test_in_september_last_year_is_settled(self) -> None:
        requests: list[httpx.Request] = []

        await an_adapter(requests=requests).fetch(temperature(), [PORTUGAL])

        assert requests[0].url.params["start_date"] == "2025-01-01"


class TestTheRequest:
    async def test_one_request_carries_every_place_of_the_country_in_order(self) -> None:
        requests: list[httpx.Request] = []

        await an_adapter(requests=requests).fetch(temperature(), [PORTUGAL])

        (request,) = requests
        assert request.url.params["latitude"] == ",".join(str(p.latitude) for p in PORTUGALS_PLACES)
        assert request.url.params["longitude"] == ",".join(
            str(p.longitude) for p in PORTUGALS_PLACES
        )
        assert request.url.params["daily"] == "temperature_2m_mean"

    async def test_requests_are_paced_to_the_free_tiers_per_minute_limit(self) -> None:
        """600 calls a minute, where a place asked for a year counts as 26. Two countries of five
        places are 260 calls, so the second request waits its share of a minute; the first
        does not wait at all."""
        spain = tuple(
            place.model_copy(update={"candidate": "country.spain"}) for place in PORTUGALS_PLACES
        )
        pauses = Pauses()

        await an_adapter(places=Places(PORTUGALS_PLACES + spain), pauses=pauses).fetch(
            temperature(), [PORTUGAL, SPAIN]
        )

        (pause,) = pauses.seconds
        assert pause == pytest.approx(5 * 365 / 14 / 500 * 60, rel=0.01)


class TestWhatIsNotAFigure:
    async def test_a_place_with_a_gap_in_its_year_is_left_out_of_the_mean(self) -> None:
        """A year with missing days is not a year's mean. The other four carry the country."""
        gappy = captured()
        gappy[0]["daily"]["temperature_2m_mean"][100] = None

        (value,) = (await an_adapter(gappy).fetch(temperature(), [PORTUGAL])).values

        assert value.quote is not None
        assert "Lisbon" not in value.quote
        assert "Porto" in value.quote

    async def test_no_complete_place_at_all_is_a_failure_not_a_figure(self) -> None:
        empty = captured()
        for location in empty:
            location["daily"]["temperature_2m_mean"][0] = None

        acquired = await an_adapter(empty).fetch(temperature(), [PORTUGAL])

        assert acquired.values == ()
        assert "complete year" in acquired.failures[0].reason

    async def test_a_country_with_no_places_declared_is_reported(self) -> None:
        acquired = await an_adapter().fetch(temperature(), [SPAIN])

        assert acquired.values == ()
        assert acquired.failures[0].candidate == "country.spain"

    async def test_an_http_refusal_is_a_failure_for_that_country(self) -> None:
        refused = {"error": True, "reason": "Daily API request limit exceeded"}

        acquired = await an_adapter(refused, status=429).fetch(temperature(), [PORTUGAL])

        assert acquired.values == ()
        assert "Daily API request limit exceeded" in acquired.failures[0].reason

    async def test_a_response_of_the_wrong_shape_is_a_failure(self) -> None:
        acquired = await an_adapter({"unexpected": "shape"}).fetch(temperature(), [PORTUGAL])

        assert acquired.values == ()
        assert acquired.failures[0].candidate == "country.portugal"

    async def test_an_attribute_it_does_not_serve_is_reported(self) -> None:
        sunshine = temperature().model_copy(update={"id": "country.annual_sunshine_hours"})

        acquired = await an_adapter().fetch(sunshine, [PORTUGAL])

        assert acquired.values == ()
        assert "annual_sunshine_hours" in acquired.failures[0].reason

    async def test_a_quantity_with_no_unit_is_a_broken_catalog_and_raises(self) -> None:
        unitless = temperature().model_copy(update={"quantity_parameters": None})

        with pytest.raises(ValueError, match="no unit"):
            await an_adapter().fetch(unitless, [PORTUGAL])


def test_it_declares_temperature_and_not_sunshine() -> None:
    """Open-Meteo's sunshine is derived from modelled radiation and runs 30% to 68% above the
    recorders' figures, unevenly -- London +60%, Madrid +32% -- so it is not fetched as hours
    of sunshine at all."""
    assert an_adapter().attributes == (TEMPERATURE,)
