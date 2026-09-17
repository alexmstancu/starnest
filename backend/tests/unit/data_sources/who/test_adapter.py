"""The Global Health Observatory becoming stored values, against a captured response.

Driven through a stub transport rather than the network. The bytes in `captured/` are real,
trimmed to the 32 candidates from 2018 onward and to one row of each aggregate kind, because
**the aggregates are what these tests are really about**: `REGION`, `GLOBAL`,
`WORLDBANKREGION` and `WORLDBANKINCOMEGROUP` rows arrive in the same array as the countries,
their `SpatialDim` looks like a country code, and one of them stored against a candidate would
be a figure describing forty countries filed as the answer for one.
"""

import json
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, IndexParameters, ValueType
from starnest.data_sources.who import WhoAdapter
from starnest.data_sources.who import adapter as who_adapter
from starnest.data_sources.who.manifest import INDICATORS

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}

HEALTHCARE = "country.healthcare_system_quality"
UHC_BOUNDS = IndexParameters(provider="WHO UHC", scale_min=Decimal(0), scale_max=Decimal(100))


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": HEALTHCARE,
        "name": "Healthcare system quality",
        "level": "country",
        "value_type": ValueType.INDEX,
        "pillar": "health",
        "index_parameters": UHC_BOUNDS,
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, alpha2: str | None, alpha3: str | None) -> Candidate:
    return Candidate(
        id=f"country.{name}",
        name=name.title(),
        level=COUNTRY,
        country_code=alpha2,
        country_code_alpha3=alpha3,
    )


def adapter_returning(body: object) -> WhoAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return WhoAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


def the_captured_adapter() -> WhoAdapter:
    return adapter_returning(json.loads((CAPTURED / "uhc_index_reported.json").read_text()))


ROMANIA = a_country("romania", "RO", "ROU")
PORTUGAL = a_country("portugal", "PT", "PRT")
GERMANY = a_country("germany", "DE", "DEU")
LIECHTENSTEIN = a_country("liechtenstein", "LI", "LIE")


class TestWhatComesBack:
    async def test_each_country_gets_its_own_newest_figure(self) -> None:
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA, PORTUGAL, GERMANY])

        figures = {v.candidate: v.payload.value for v in acquired.values}
        assert figures == {
            "country.romania": Decimal("77"),
            "country.portugal": Decimal("83"),
            "country.germany": Decimal("87"),
        }

    async def test_the_figure_sits_on_the_scale_the_catalog_declares(self) -> None:
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        payload = acquired.values[0].payload
        assert payload.provider == "WHO UHC"
        assert (payload.scale_min, payload.scale_max) == (Decimal(0), Decimal(100))

    async def test_the_reference_period_is_the_year_the_figure_describes(self) -> None:
        """Distinct from the retrieval date, and never merged with it (`reqs.md` 3.6)."""
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        stored = acquired.values[0]
        assert stored.reference_period.start.year == 2023
        assert stored.reference_period.end.year == 2023
        assert "2023" in stored.quote

    async def test_the_value_names_who_as_its_source(self) -> None:
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        assert acquired.values[0].data_source == "who"
        assert acquired.values[0].confidence_level is ConfidenceLevel.HIGH

    async def test_the_quote_names_the_indicator_that_was_actually_fetched(self) -> None:
        """**Provenance has to survive a second indicator** (P58 low).

        The quote was the literal string "WHO UHC Service Coverage Index" whatever was asked
        for, which is true only while this manifest holds one entry. A second WHO indicator is
        a manifest-and-catalog change with no code in it -- exactly the change this adapter
        exists to make cheap -- and every figure of it would have carried the first one's name.
        """
        air_quality = an_attribute(
            id="country.air_quality", name="Air quality", index_parameters=UHC_BOUNDS
        )
        with_a_second_indicator = {**INDICATORS, air_quality.id: "PM25_MEAN"}

        with patch.object(who_adapter, "INDICATORS", with_a_second_indicator):
            acquired = await the_captured_adapter().fetch(air_quality, [ROMANIA])

        quote = acquired.values[0].quote
        assert quote is not None
        assert "PM25_MEAN" in quote
        assert "UHC" not in quote, "the first indicator's name must not travel"


class TestTheAggregatesThatLookLikeCountries:
    """The failure this adapter is most likely to have, and the least likely to be noticed."""

    async def test_a_region_code_never_becomes_a_candidates_figure(self) -> None:
        """`WPR` is the Western Pacific Region. It is three uppercase letters, like every real
        alpha-3 code in the file, and describes thirty-seven countries."""
        acquired = await the_captured_adapter().fetch(
            an_attribute(), [a_country("nowhere", "XX", "WPR")]
        )

        assert acquired.values == ()

    def test_the_other_aggregate_kinds_cannot_even_be_asked_for(self) -> None:
        """`GLOBAL`, `WB_NAR` and `WB_UMI` are not three uppercase letters, so
        `CountryCodeAlpha3` refuses them before any adapter sees one -- they are unreachable
        by construction rather than filtered. Only a region code shaped like a real alpha-3,
        which `WPR` is, could ever collide, and that is the case tested above.

        Whether the decoder drops every aggregate kind is tested where they all arrive, in
        `test_response.py`, rather than through a candidate that cannot hold most of them.
        """
        for aggregate in ("GLOBAL", "WB_NAR", "WB_UMI"):
            with pytest.raises(ValueError, match="alpha-3"):
                a_country("nowhere", "XX", aggregate)

    async def test_the_aggregates_are_dropped_rather_than_reported_as_failures(self) -> None:
        """They are not errors. They are rows for something this application does not rank."""
        acquired = await the_captured_adapter().fetch(an_attribute(), [ROMANIA])

        assert acquired.failures == ()


class TestWhatIsDeliberatelyNotFilledIn:
    async def test_a_country_who_has_nothing_for_produces_no_value(self) -> None:
        """Liechtenstein, which WHO does not report and Eurostat does not survey. Its gap
        travels to the ranking as coverage; the World Bank is the only source that answers it.
        """
        acquired = await the_captured_adapter().fetch(an_attribute(), [LIECHTENSTEIN])

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_a_candidate_with_no_alpha_3_is_reported_not_skipped(self) -> None:
        """Silence would look identical to WHO having no figure, and the two need different
        answers: one is a gap in the data, the other a gap in the catalog."""
        acquired = await the_captured_adapter().fetch(
            an_attribute(), [ROMANIA, a_country("atlantis", None, None)]
        )

        assert [v.candidate for v in acquired.values] == ["country.romania"]
        assert acquired.failures[0].candidate == "country.atlantis"
        assert "alpha-3" in acquired.failures[0].reason


class TestWhenTheRequestGoesWrong:
    async def test_an_http_error_becomes_a_failure_rather_than_an_exception(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="unavailable")

        adapter = WhoAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(an_attribute(), [ROMANIA])

        assert acquired.values == ()
        assert "503" in acquired.failures[0].reason

    async def test_a_transport_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        adapter = WhoAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert (
            "no route to host"
            in (await adapter.fetch(an_attribute(), [ROMANIA])).failures[0].reason
        )

    async def test_a_body_that_is_not_the_usual_envelope_becomes_a_failure(self) -> None:
        acquired = await adapter_returning({"unexpected": True}).fetch(an_attribute(), [ROMANIA])

        assert "without its usual value array" in acquired.failures[0].reason

    async def test_an_attribute_this_adapter_has_no_indicator_for_is_reported(self) -> None:
        acquired = await the_captured_adapter().fetch(
            an_attribute(id="country.press_freedom"), [ROMANIA]
        )

        assert acquired.values == ()
        assert "publishes no indicator" in acquired.failures[0].reason

    async def test_a_figure_outside_the_declared_scale_is_reported_per_candidate(self) -> None:
        acquired = await adapter_returning(
            {"value": [_row("ROU", 2023, 140.0), _row("PRT", 2023, 83.0)]}
        ).fetch(an_attribute(), [ROMANIA, PORTUGAL])

        assert [v.candidate for v in acquired.values] == ["country.portugal"]
        assert "outside the WHO UHC scale" in acquired.failures[0].reason

    async def test_an_index_attribute_with_no_scale_is_a_broken_catalog_and_raises(self) -> None:
        with pytest.raises(ValueError, match="gives it no scale"):
            await the_captured_adapter().fetch(an_attribute(index_parameters=None), [ROMANIA])


class TestWhatTheAdapterClaimsToBe:
    def test_it_names_the_data_source_row_the_catalog_seeds(self) -> None:
        """`who`, exactly. A different string is a foreign key violation on insert, long after
        the fetch that produced it looked fine."""
        assert WhoAdapter(httpx.AsyncClient()).data_source == "who"

    def test_it_declares_only_the_attribute_it_can_answer(self) -> None:
        assert WhoAdapter(httpx.AsyncClient()).attributes == (HEALTHCARE,)

    async def test_it_asks_for_the_indicator_by_its_who_code(self) -> None:
        asked: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            asked.append(request)
            return httpx.Response(200, json={"value": []})

        adapter = WhoAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        await adapter.fetch(an_attribute(), [ROMANIA])

        assert str(asked[0].url).endswith("/UHC_INDEX_REPORTED")


def _row(country: str, year: int, figure: float | None) -> dict:
    return {
        "IndicatorCode": "UHC_INDEX_REPORTED",
        "SpatialDimType": "COUNTRY",
        "SpatialDim": country,
        "TimeDimType": "YEAR",
        "TimeDim": year,
        "NumericValue": figure,
        "Value": str(figure),
    }
