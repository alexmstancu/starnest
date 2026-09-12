"""WGI estimates becoming stored values, against responses captured from the live API.

Driven through a stub transport rather than the network: a test that reaches the World Bank
fails when the World Bank is slow, which says nothing about this code. The bytes in `captured/`
are real, so the envelope parsing, the pairing of three series per country and the reference
period are exercised against the shape that exists rather than one imagined.

**The rule these tests defend above the others**: what the World Bank says about how solid an
estimate is must survive into the provenance. Liechtenstein's rule-of-law estimate is *higher*
than Germany's and rests on four underlying sources against Germany's thirteen -- a reader
looking at the ranking has to be able to see that, or the number is more confident than the
evidence behind it.
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
    IndexParameters,
    RatioParameters,
    ValueType,
)
from starnest.data_sources.world_bank import WorldBankAdapter

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}

RULE_OF_LAW = "country.rule_of_law"
WGI_BOUNDS = IndexParameters(
    provider="World Bank WGI", scale_min=Decimal("-2.5"), scale_max=Decimal("2.5")
)


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": RULE_OF_LAW,
        "name": "Rule of law",
        "level": "country",
        "value_type": ValueType.INDEX,
        "pillar": "governance",
        "index_parameters": WGI_BOUNDS,
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


FOREST_COVER = "country.forest_cover"
FOREST_SERIES = "AG.LND.FRST.ZS"


def a_forest_attribute(**overrides: object) -> Attribute:
    """The other collection's shape: a `Ratio` that names what it is a share of."""
    fields: dict[str, object] = {
        "id": FOREST_COVER,
        "name": "Forest cover",
        "level": "country",
        "value_type": ValueType.RATIO,
        "pillar": "nature",
        "ratio_parameters": RatioParameters(basis="land_area"),
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, code: str | None) -> Candidate:
    return Candidate(id=f"country.{name}", name=name.title(), level=COUNTRY, country_code=code)


def adapter_returning(body: object) -> WorldBankAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


def adapter_for(fixture: str) -> WorldBankAdapter:
    return adapter_returning(json.loads((CAPTURED / f"{fixture}.json").read_text()))


class TestWhatComesBack:
    async def test_every_country_the_estimate_covers_gets_a_value(self) -> None:
        candidates = [a_country("romania", "RO"), a_country("germany", "DE")]

        acquired = await adapter_for("rule_of_law").fetch(an_attribute(), candidates)

        assert len(acquired.values) == 2
        assert acquired.failures == ()

    async def test_the_value_carries_the_figure_on_the_scale_the_catalog_declares(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("romania", "RO")]
        )

        payload = acquired.values[0].payload
        assert payload.value == Decimal("0.3710995")
        assert payload.provider == "World Bank WGI"
        assert (payload.scale_min, payload.scale_max) == (Decimal("-2.5"), Decimal("2.5"))

    async def test_the_reference_period_is_the_whole_year_the_estimate_describes(self) -> None:
        """Distinct from the retrieval date, and never merged with it (`reqs.md` 3.6)."""
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("romania", "RO")]
        )

        stored = acquired.values[0]
        assert stored.reference_period.start == date(2024, 1, 1)
        assert stored.reference_period.end == date(2024, 12, 31)
        assert stored.retrieval_date.date() != stored.reference_period.start

    async def test_the_value_names_the_world_bank_as_its_source(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("romania", "RO")]
        )

        assert acquired.values[0].data_source == "world_bank"


class TestHowSolidTheEstimateIs:
    """Option A of `docs/devplan.md` D7's confidence question, and why it is not a threshold."""

    async def test_the_provenance_names_how_many_sources_the_estimate_rests_on(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("liechtenstein", "LI"), a_country("germany", "DE")]
        )

        quotes = {v.candidate: v.quote for v in acquired.values}
        assert "4 underlying sources" in quotes["country.liechtenstein"]
        assert "13 underlying sources" in quotes["country.germany"]

    async def test_the_provenance_names_the_world_banks_own_uncertainty(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("liechtenstein", "LI")]
        )

        assert "standard error 0.2419092" in acquired.values[0].quote

    async def test_the_thinnest_evidenced_country_can_still_top_the_estimate(self) -> None:
        """The reason this is recorded at all, in one assertion.

        Liechtenstein scores above Germany on four sources against thirteen. Both figures are
        real and neither is wrong; only the provenance tells them apart.
        """
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("liechtenstein", "LI"), a_country("germany", "DE")]
        )

        by_candidate = {v.candidate: v.payload.value for v in acquired.values}
        assert by_candidate["country.liechtenstein"] > by_candidate["country.germany"]

    async def test_every_figure_is_high_confidence_because_none_is_flagged_otherwise(
        self,
    ) -> None:
        """No cut point is invented. The World Bank flags nothing here as provisional, so
        nothing is demoted; the count is carried instead, for a decision with data behind it."""
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("liechtenstein", "LI"), a_country("germany", "DE")]
        )

        assert {v.confidence_level for v in acquired.values} == {ConfidenceLevel.HIGH}

    async def test_a_single_source_is_described_in_the_singular(self) -> None:
        acquired = await adapter_returning(
            [{"pages": 1}, [_row("RO", 1.0), _row("RO", 1, "GOV_WGI_RL.SR")]]
        ).fetch(an_attribute(), [a_country("romania", "RO")])

        assert acquired.values[0].quote.endswith("(1 underlying source)")

    async def test_an_estimate_arriving_alone_is_still_stored(self) -> None:
        """The three series are requested together but arrive independently. A missing count is
        a quieter provenance, never a missing value."""
        acquired = await adapter_returning([{"pages": 1}, [_row("RO", 1.0)]]).fetch(
            an_attribute(), [a_country("romania", "RO")]
        )

        assert acquired.values[0].quote == "World Bank WGI 2024: 1.0"


class TestWhatIsDeliberatelyNotFilledIn:
    async def test_a_country_the_estimate_has_nothing_for_produces_no_value(self) -> None:
        """And no failure either. A gap is coverage, not something to triage (`reqs.md` 5.3)."""
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("romania", "RO"), a_country("narnia", "ZZ")]
        )

        assert [v.candidate for v in acquired.values] == ["country.romania"]
        assert acquired.failures == ()

    async def test_a_country_with_only_a_source_count_produces_no_value(self) -> None:
        """The count describes an estimate. Without one there is nothing it describes."""
        acquired = await adapter_returning([{"pages": 1}, [_row("RO", 13, "GOV_WGI_RL.SR")]]).fetch(
            an_attribute(), [a_country("romania", "RO")]
        )

        assert acquired.values == ()


class TestWhatCannotBeAsked:
    async def test_a_candidate_with_no_country_code_is_reported_not_skipped(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(), [a_country("romania", "RO"), a_country("atlantis", None)]
        )

        assert [v.candidate for v in acquired.values] == ["country.romania"]
        assert len(acquired.failures) == 1
        assert acquired.failures[0].candidate == "country.atlantis"
        assert "no country code" in acquired.failures[0].reason

    async def test_nothing_is_requested_when_no_candidate_can_be_asked_about(self) -> None:
        """A URL with an empty country segment asks the World Bank for every country on earth."""
        asked: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            asked.append(request)
            return httpx.Response(200, json=[{"pages": 1}, []])

        adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(an_attribute(), [a_country("atlantis", None)])

        assert asked == []
        assert len(acquired.failures) == 1

    async def test_an_attribute_this_adapter_has_no_series_for_is_reported(self) -> None:
        acquired = await adapter_for("rule_of_law").fetch(
            an_attribute(id="country.avg_annual_temperature"), [a_country("romania", "RO")]
        )

        assert acquired.values == ()
        assert "publishes no series" in acquired.failures[0].reason

    async def test_the_adapter_declares_only_the_attributes_it_can_answer(self) -> None:
        declared = WorldBankAdapter(httpx.AsyncClient()).attributes

        assert set(declared) == {
            "country.rule_of_law",
            "country.control_of_corruption",
            "country.political_economic_stability",
            "country.forest_cover",
        }


class TestWhenTheRequestGoesWrong:
    async def test_an_http_error_becomes_a_failure_rather_than_an_exception(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="unavailable")

        adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(an_attribute(), [a_country("romania", "RO")])

        assert acquired.values == ()
        assert "503" in acquired.failures[0].reason

    async def test_a_transport_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(an_attribute(), [a_country("romania", "RO")])

        assert "no route to host" in acquired.failures[0].reason

    async def test_a_refusal_sent_as_200_becomes_a_failure_naming_what_it_said(self) -> None:
        adapter = adapter_returning(
            [{"message": [{"id": "175", "value": "The indicator was not found."}]}]
        )

        acquired = await adapter.fetch(an_attribute(), [a_country("romania", "RO")])

        assert acquired.values == ()
        assert "The indicator was not found" in acquired.failures[0].reason

    async def test_a_candidate_with_no_code_is_still_reported_when_the_request_fails(self) -> None:
        """Both failures reach the run. Losing one because the other happened would hide it."""

        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="unavailable")

        adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(
            an_attribute(), [a_country("romania", "RO"), a_country("atlantis", None)]
        )

        assert len(acquired.failures) == 2


class TestFiguresTheDocumentationDidNotPromise:
    """The World Bank documents the scale as "approx. -2.5 to +2.5", and approx is not a bound."""

    async def test_a_figure_outside_the_declared_scale_is_reported_per_candidate(self) -> None:
        adapter = adapter_returning([{"pages": 1}, [_row("RO", 3.4), _row("PT", 1.0)]])

        acquired = await adapter.fetch(
            an_attribute(), [a_country("romania", "RO"), a_country("portugal", "PT")]
        )

        assert [v.candidate for v in acquired.values] == ["country.portugal"]
        assert acquired.failures[0].candidate == "country.romania"
        assert "outside the World Bank WGI scale" in acquired.failures[0].reason

    async def test_one_odd_country_does_not_cost_the_others(self) -> None:
        adapter = adapter_returning([{"pages": 1}, [_row("RO", -9.9), _row("PT", 1.0)]])

        acquired = await adapter.fetch(
            an_attribute(), [a_country("romania", "RO"), a_country("portugal", "PT")]
        )

        assert len(acquired.values) == 1
        assert len(acquired.failures) == 1

    async def test_an_index_attribute_with_no_scale_is_a_broken_catalog_and_raises(self) -> None:
        """Loudly and once, rather than recorded 32 times as though the source misbehaved."""
        adapter = adapter_returning([{"pages": 1}, [_row("RO", 1.0)]])

        with pytest.raises(ValueError, match="gives it no scale"):
            await adapter.fetch(an_attribute(index_parameters=None), [a_country("romania", "RO")])


class TestTheRequestItself:
    async def test_it_names_the_databank_the_wgi_actually_lives_in(self) -> None:
        """Without `source=3` the API answers "not found" for a series that exists."""
        request = await _the_request_for([a_country("romania", "RO")])

        assert request.url.params["source"] == "3"

    async def test_it_asks_for_each_countrys_own_newest_figure(self) -> None:
        request = await _the_request_for([a_country("romania", "RO")])

        assert request.url.params["mrnev"] == "1"

    async def test_it_asks_for_all_three_series_in_one_call(self) -> None:
        request = await _the_request_for([a_country("romania", "RO")])

        assert "GOV_WGI_RL.EST;GOV_WGI_RL.SR;GOV_WGI_RL.SE" in str(request.url)

    async def test_it_sizes_the_page_to_the_answer_so_nothing_is_truncated(self) -> None:
        """Three series per country. Left at the default 50, 32 countries would come back
        split, and the decoder would refuse it."""
        request = await _the_request_for([a_country("romania", "RO"), a_country("portugal", "PT")])

        assert request.url.params["per_page"] == "6"

    async def test_it_asks_only_about_candidates_that_have_a_country_code(self) -> None:
        request = await _the_request_for([a_country("romania", "RO"), a_country("atlantis", None)])

        assert "/country/RO/" in str(request.url)


class TestASeriesFromTheOtherCollection:
    """Forest cover: one series, a different databank, and a `Ratio` rather than an `Index`.

    **The same publisher answering a different question.** The envelope, the decoder and the
    request shape are identical -- what differs is which collection holds the series and what
    the catalog says the figure *is*. So this class is the evidence that the generalisation went
    to the right place: the manifest gained a second kind of indicator, and the adapter reads
    the payload's shape off the `Attribute` instead of assuming every figure is an index.
    """

    async def test_a_share_of_land_area_becomes_a_ratio_with_its_basis(self) -> None:
        """A bare 32.7% is not a measurement: 32.7% of the land area and 32.7% of the workforce
        are different facts, and only the basis distinguishes them."""
        adapter = adapter_returning(
            [{"pages": 1}, [_row("DE", 32.685482024273, series=FOREST_SERIES)]]
        )

        acquired = await adapter.fetch(a_forest_attribute(), [a_country("germany", "DE")])

        (value,) = acquired.values
        assert value.payload.value_type is ValueType.RATIO
        assert value.payload.basis == "land_area"
        assert value.payload.value == Decimal("32.685482024273")

    async def test_it_names_the_publication_rather_than_the_wgi(self) -> None:
        """The quote is what a reader checks the figure against, so it must not say WGI about a
        series the WGI does not contain."""
        adapter = adapter_returning([{"pages": 1}, [_row("DE", 32.7, series=FOREST_SERIES)]])

        acquired = await adapter.fetch(a_forest_attribute(), [a_country("germany", "DE")])

        (value,) = acquired.values
        assert value.quote is not None
        assert "World Bank WDI" in value.quote
        assert "WGI" not in value.quote

    async def test_it_carries_no_uncertainty_the_publisher_does_not_state(self) -> None:
        """A WGI estimate's quote names its source count and standard error. Forest area has
        neither, and printing "0 underlying sources" would be a claim about solidity that
        nobody published."""
        adapter = adapter_returning([{"pages": 1}, [_row("DE", 32.7, series=FOREST_SERIES)]])

        acquired = await adapter.fetch(a_forest_attribute(), [a_country("germany", "DE")])

        (value,) = acquired.values
        assert value.quote is not None
        assert "underlying source" not in value.quote
        assert "standard error" not in value.quote

    async def test_it_asks_the_default_databank_and_for_one_series(self) -> None:
        """Asking databank 3 for forest cover answers a 200 carrying a refusal, which would be
        recorded as "the World Bank has nothing" for a series it publishes."""
        asked: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            asked.append(request)
            return httpx.Response(200, json=[{"pages": 1}, []])

        adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        await adapter.fetch(
            a_forest_attribute(), [a_country("germany", "DE"), a_country("romania", "RO")]
        )

        assert asked[0].url.params["source"] == "2"
        assert FOREST_SERIES in str(asked[0].url)
        # One row per country, not three: the page is sized to what this indicator returns.
        assert asked[0].url.params["per_page"] == "2"

    async def test_an_attribute_of_a_type_it_cannot_shape_is_refused_loudly(self) -> None:
        """A broken catalog rather than a failed fetch, so it raises once instead of being
        recorded 32 times as though the World Bank had done something wrong."""
        adapter = adapter_returning([{"pages": 1}, []])

        with pytest.raises(ValueError, match="index and ratio series only"):
            await adapter.fetch(
                a_forest_attribute(value_type=ValueType.COUNT, ratio_parameters=None),
                [a_country("germany", "DE")],
            )

    async def test_a_ratio_with_no_basis_in_the_catalog_is_refused(self) -> None:
        """The basis is required on the payload, so an absent one would fail 32 times over. It
        is a catalog fault and says so once."""
        adapter = adapter_returning([{"pages": 1}, []])

        with pytest.raises(ValueError, match="names no basis"):
            await adapter.fetch(
                a_forest_attribute(ratio_parameters=None), [a_country("germany", "DE")]
            )


async def _the_request_for(candidates: list[Candidate]) -> httpx.Request:
    asked: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return httpx.Response(200, json=[{"pages": 1}, []])

    adapter = WorldBankAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    await adapter.fetch(an_attribute(), candidates)
    return asked[0]


def _row(country: str, value: object, series: str = "GOV_WGI_RL.EST") -> dict:
    return {
        "indicator": {"id": series, "value": "Rule of Law"},
        "country": {"id": country, "value": country},
        "countryiso3code": country,
        "date": "2024",
        "value": value,
        "obs_status": "",
        "decimal": 1,
    }
