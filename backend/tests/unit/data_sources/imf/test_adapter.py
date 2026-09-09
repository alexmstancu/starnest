"""WEO projections becoming stored values, against a captured response.

The fixture keeps the 32 candidates **and nine of the IMF's aggregates** -- `EURO`, `EU`,
`EUQ`, `WE`, `WEOWORLD`, `ADVEC`, `SSA`, `NAQ`, `EAQ` -- because those are the hazard here.
The response marks no difference between an economy and a group of them, and several aggregate
codes are three uppercase letters, so unlike WHO's they are not ruled out by the shape of an
alpha-3 code. What keeps them out is that this adapter only ever looks up codes its own
candidates carry.
"""

import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, QuantityParameters, ValueType
from starnest.data_sources.imf import INDICATORS, ImfAdapter

CAPTURED = Path(__file__).parent / "captured"
MIGRATIONS = Path(__file__).resolve().parents[5] / "storage" / "migrations"
COUNTRY = {"id": "country", "depth_order": 1}

OUTLOOK = "country.economic_outlook"
A_YEAR_WHOSE_FORECAST_THE_FIXTURE_HAS = date(2026, 9, 9)
"""Pinned, because "next year" moves and the fixture does not."""


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": OUTLOOK,
        "name": "Economic outlook",
        "level": "country",
        "value_type": ValueType.QUANTITY,
        "pillar": "economics",
        "quantity_parameters": QuantityParameters(unit="percent_per_year"),
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, alpha3: str | None) -> Candidate:
    return Candidate(
        id=f"country.{name}",
        name=name.title(),
        level=COUNTRY,
        country_code="XX" if alpha3 is None else alpha3[:2],
        country_code_alpha3=alpha3,
    )


def adapter_returning(body: object, today: date = A_YEAR_WHOSE_FORECAST_THE_FIXTURE_HAS):
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return ImfAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)), today=today)


def the_captured_adapter(today: date = A_YEAR_WHOSE_FORECAST_THE_FIXTURE_HAS):
    return adapter_returning(json.loads((CAPTURED / "ngdp_rpch.json").read_text()), today)


ROMANIA = a_country("romania", "ROU")
PORTUGAL = a_country("portugal", "PRT")
GERMANY = a_country("germany", "DEU")
LIECHTENSTEIN = a_country("liechtenstein", "LIE")


class TestWhichYearIsRead:
    async def test_it_reads_next_year_rather_than_the_furthest_year_published(self) -> None:
        """WEO runs to 2031. Romania's 2031 figure is 3.1 and its 2027 figure is 2.5; the
        latter is a forecast, the former a long-run growth assumption."""
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        assert acquired.values[0].payload.magnitude == Decimal("2.5")

    async def test_the_reference_period_is_the_year_forecast_not_the_year_of_the_forecast(
        self,
    ) -> None:
        """A projection for 2027 describes 2027, so that is what it is stored against. Reading
        it as current would make a forecast look like a measurement (`reqs.md` 3.6)."""
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        stored = acquired.values[0]
        assert stored.reference_period.start == date(2027, 1, 1)
        assert stored.reference_period.end == date(2027, 12, 31)
        # The two dates are never merged: this was fetched today and describes a year that
        # has not happened, which only the pair can say.
        assert stored.retrieval_date.date() < stored.reference_period.start

    async def test_the_year_moves_with_the_clock(self) -> None:
        """Which year counts as "next" is a fact about when the fetch happened, so it is read
        from the clock rather than pinned in the manifest."""
        acquired = await the_captured_adapter(today=date(2028, 3, 1)).fetch(
            an_attribute(), [ROMANIA]
        )

        assert acquired.values[0].reference_period.start.year == 2029
        assert acquired.values[0].payload.magnitude == Decimal("2.9")


class TestWhatAForecastIs:
    async def test_it_is_stored_at_medium_confidence_because_it_is_not_a_measurement(
        self,
    ) -> None:
        """Every other value in this system records something that happened. This one records
        what the IMF expects, and `medium` says so without implying the IMF is unreliable."""
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        assert acquired.values[0].confidence_level is ConfidenceLevel.MEDIUM

    async def test_the_provenance_says_it_is_a_projection_and_for_which_year(self) -> None:
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        assert "projection for 2027" in acquired.values[0].quote

    async def test_a_negative_forecast_is_stored_as_published(self) -> None:
        """Growth can be negative and a contraction is a real figure, not an error."""
        acquired = await the_captured_adapter(today=date(2025, 6, 1)).fetch(
            an_attribute(), [LIECHTENSTEIN]
        )

        assert acquired.values[0].payload.magnitude == Decimal("-0.4")


class TestTheAggregatesThatLookLikeCountries:
    def test_no_aggregate_code_is_one_of_our_candidates_codes(self) -> None:
        """**The assumption the whole design rests on, asserted rather than trusted.**

        Nothing in the response distinguishes `EUQ` from `ROU`. What keeps a euro-area figure
        out of a country's record is that the adapter looks up only the codes its candidates
        carry, and those are ISO's. If an aggregate code ever collided with a real alpha-3,
        this is where it would be noticed.
        """
        document = json.loads((CAPTURED / "ngdp_rpch.json").read_text())
        published = set(document["values"]["NGDP_RPCH"])
        aggregates = {"EURO", "EU", "EUQ", "WE", "WEOWORLD", "ADVEC", "SSA", "NAQ", "EAQ"}

        assert aggregates <= published, "the fixture must carry aggregates or this proves nothing"
        assert aggregates.isdisjoint(_the_alpha_3_codes_we_seed())

    async def test_an_aggregate_is_never_returned_for_a_real_candidate(self) -> None:
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA, PORTUGAL, GERMANY])

        assert {v.candidate for v in acquired.values} == {
            "country.romania",
            "country.portugal",
            "country.germany",
        }


class TestWhatIsDeliberatelyNotFilledIn:
    async def test_a_country_with_no_forecast_for_that_year_produces_no_value(self) -> None:
        """Not the nearest year, and not the euro-area figure standing in for it."""
        acquired = await the_captured_adapter(today=date(2040, 1, 1)).fetch(
            an_attribute(), [ROMANIA]
        )

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_a_candidate_with_no_alpha_3_is_reported_not_skipped(self) -> None:
        acquired = await the_captured_adapter().fetch(
            an_attribute(), [ROMANIA, a_country("atlantis", None)]
        )

        assert [v.candidate for v in acquired.values] == ["country.romania"]
        assert "alpha-3" in acquired.failures[0].reason


class TestWhenTheRequestGoesWrong:
    async def test_an_http_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="server error")

        adapter = ImfAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert "500" in (await adapter.fetch(an_attribute(), [ROMANIA])).failures[0].reason

    async def test_a_transport_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        adapter = ImfAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert "no route" in (await adapter.fetch(an_attribute(), [ROMANIA])).failures[0].reason

    async def test_a_body_without_the_values_object_becomes_a_failure(self) -> None:
        acquired = await adapter_returning({"api": {}}).fetch(an_attribute(), [ROMANIA])

        assert "without its usual values object" in acquired.failures[0].reason

    async def test_an_attribute_this_adapter_has_no_indicator_for_is_reported(self) -> None:
        acquired = await the_captured_adapter().fetch(
            an_attribute(id="country.press_freedom"), [ROMANIA]
        )

        assert "publishes no indicator" in acquired.failures[0].reason

    async def test_a_quantity_attribute_with_no_unit_is_a_broken_catalog_and_raises(
        self,
    ) -> None:
        with pytest.raises(ValueError, match="gives it no unit"):
            await the_captured_adapter().fetch(an_attribute(quantity_parameters=None), [ROMANIA])


class TestWhatTheAdapterClaimsToBe:
    def test_it_names_the_data_source_row_the_catalog_seeds(self) -> None:
        assert ImfAdapter(httpx.AsyncClient()).data_source == "imf"

    def test_it_declares_only_the_attribute_it_can_answer(self) -> None:
        assert ImfAdapter(httpx.AsyncClient()).attributes == (OUTLOOK,)

    async def test_it_asks_for_the_indicator_by_its_imf_code(self) -> None:
        asked: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            asked.append(request)
            return httpx.Response(200, json={"values": {"NGDP_RPCH": {}}})

        adapter = ImfAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        await adapter.fetch(an_attribute(), [ROMANIA])

        assert str(asked[0].url).endswith("/NGDP_RPCH")

    def test_the_manifest_names_the_weo_headline_series(self) -> None:
        assert INDICATORS[OUTLOOK] == "NGDP_RPCH"


def _the_alpha_3_codes_we_seed() -> set[str]:
    """The 32 codes migration `0440` puts on the candidates, read from the migration itself.

    Read rather than retyped: a copy here would agree with the migration on the day it was
    written and drift silently afterwards, which is exactly the drift this test exists to
    catch.
    """
    seeded = (MIGRATIONS / "0440-country-codes-alpha-3.sql").read_text()
    return {alpha3 for _, alpha3 in re.findall(r"'([A-Z]{2})', '([A-Z]{3})'", seeded)}
