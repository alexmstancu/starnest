"""The total tax rate from OECD Taxing Wages, against a captured response.

The fixture keeps the whole structure and 44 of 4,768 series: the one matching series for each
of 40 areas, and four **decoys** -- Germany and Belgium at other income levels or units -- so
the selection is tested against series that differ in exactly one dimension. Two of the 40
areas are aggregates (`OECD_REP`, `EU22OECD`), which nothing should ever look up.
"""

import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, RatioParameters, ValueType
from starnest.data_sources.oecd import SERIES, OecdAdapter, OecdError, figures

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}
TAX = "country.total_tax_rate_effective"


def captured() -> dict:
    return json.loads((CAPTURED / "awcomp.json").read_text())


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": TAX,
        "name": "Total effective tax rate",
        "level": "country",
        "value_type": ValueType.RATIO,
        "pillar": "economics",
        "ratio_parameters": RatioParameters(basis="labour_cost"),
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, alpha3: str | None) -> Candidate:
    return Candidate(
        id=f"country.{name}",
        name=name.title(),
        level=COUNTRY,
        country_code=None if alpha3 is None else alpha3[:2],
        country_code_alpha3=alpha3,
    )


def adapter_returning(body: object) -> OecdAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return OecdAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


BELGIUM = a_country("belgium", "BEL")
GERMANY = a_country("germany", "DEU")
SWITZERLAND = a_country("switzerland", "CHE")
ROMANIA = a_country("romania", "ROU")


class TestTheFigureIsTheWholeWedge:
    async def test_it_reads_the_high_earner_wedge_for_each_country(self) -> None:
        acquired = await adapter_returning(captured()).fetch(
            an_attribute(), [BELGIUM, GERMANY, SWITZERLAND]
        )

        rates = {v.candidate: round(v.payload.value, 1) for v in acquired.values}
        assert rates == {
            "country.belgium": Decimal("58.6"),
            "country.germany": Decimal("50.0"),
            "country.switzerland": Decimal("27.4"),
        }

    async def test_the_rate_is_a_share_of_labour_cost_as_the_catalog_declares(self) -> None:
        """Over labour cost, not gross: the employer's share sits on top of gross, and dividing
        by gross would make the rate depend on the split again (Q205)."""
        acquired = await adapter_returning(captured()).fetch(an_attribute(), [BELGIUM])

        assert acquired.values[0].payload.basis == "labour_cost"

    async def test_the_value_carries_its_year_and_its_source(self) -> None:
        acquired = await adapter_returning(captured()).fetch(an_attribute(), [BELGIUM])

        stored = acquired.values[0]
        assert stored.reference_period.start.year == 2025
        assert stored.data_source == "oecd"
        assert stored.confidence_level is ConfidenceLevel.HIGH
        assert stored.quote.startswith("OECD OECD.CTP.TPS,DSD_TAX_WAGES_COMP@DF_TW_COMP 2025:")


class TestTheSelectionPicksExactlyOneSeries:
    def test_a_decoy_differing_in_one_dimension_is_not_taken(self) -> None:
        """Germany is in the fixture at other income levels and units too. Only the high-earner
        wedge over labour cost is read, and it is 50.0 -- not the average-wage 49.3."""
        rates = figures(captured(), SERIES[TAX].selection)

        assert round(rates["DEU"]["2025"], 1) == Decimal("50.0")

    def test_a_selection_matching_two_series_for_one_country_is_refused(self) -> None:
        """Dropping the income level leaves Germany matched at several of them. Taking the first
        would silently choose an income level nobody chose."""
        too_loose = {k: v for k, v in SERIES[TAX].selection.items() if k != "INCOME_PRINCIPAL"}

        with pytest.raises(OecdError, match="more than one series matches for"):
            figures(captured(), too_loose)

    def test_a_dimension_the_dataflow_does_not_have_is_refused(self) -> None:
        with pytest.raises(OecdError, match="no dimension called COLOUR"):
            figures(captured(), {"COLOUR": "blue"})


class TestWhatIsDeliberatelyNotFilledIn:
    async def test_a_country_outside_taxing_wages_produces_no_value(self) -> None:
        """Romania is one of six the OECD does not cover. No value, and no failure: a gap."""
        acquired = await adapter_returning(captured()).fetch(an_attribute(), [ROMANIA])

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_a_candidate_with_no_alpha_3_is_reported(self) -> None:
        acquired = await adapter_returning(captured()).fetch(
            an_attribute(), [BELGIUM, a_country("atlantis", None)]
        )

        assert [v.candidate for v in acquired.values] == ["country.belgium"]
        assert "alpha-3" in acquired.failures[0].reason

    def test_a_null_observation_is_not_a_figure(self) -> None:
        document = captured()
        series = document["data"]["dataSets"][0]["series"]
        for body in series.values():
            for index in body["observations"]:
                body["observations"][index] = [None]

        assert all(not by_period for by_period in figures(document, SERIES[TAX].selection).values())


class TestTheShapesThatAreNotAnAnswer:
    @pytest.mark.parametrize(
        ("document", "message"),
        [
            pytest.param({"no": "data"}, "without its usual data object", id="no data"),
            pytest.param({"data": {}, "errors": ["bad"]}, "reported errors", id="errors"),
            pytest.param({"data": {}}, "without a structure and a dataset", id="empty data"),
        ],
    )
    def test_an_unreadable_envelope_is_refused(self, document: object, message: str) -> None:
        with pytest.raises(OecdError, match=message):
            figures(document, {})

    def test_a_series_key_the_structure_cannot_decode_is_refused(self) -> None:
        document = captured()
        document["data"]["dataSets"][0]["series"] = {"99:99": {"observations": {}}}

        with pytest.raises(OecdError, match="not a series key"):
            figures(document, {})

    async def test_an_http_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="unavailable")

        adapter = OecdAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert "503" in (await adapter.fetch(an_attribute(), [BELGIUM])).failures[0].reason

    async def test_a_transport_error_becomes_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        adapter = OecdAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert "no route" in (await adapter.fetch(an_attribute(), [BELGIUM])).failures[0].reason

    async def test_an_attribute_this_adapter_has_no_series_for_is_reported(self) -> None:
        acquired = await adapter_returning(captured()).fetch(
            an_attribute(id="country.press_freedom"), [BELGIUM]
        )

        assert "publishes no series" in acquired.failures[0].reason

    async def test_a_ratio_with_no_basis_is_a_broken_catalog_and_raises(self) -> None:
        with pytest.raises(ValueError, match="gives it no basis"):
            await adapter_returning(captured()).fetch(
                an_attribute(ratio_parameters=None), [BELGIUM]
            )


class TestWhatTheAdapterClaimsToBe:
    def test_it_names_the_data_source_row_the_catalog_seeds(self) -> None:
        assert OecdAdapter(httpx.AsyncClient()).data_source == "oecd"

    def test_it_declares_only_the_attribute_it_can_answer(self) -> None:
        assert OecdAdapter(httpx.AsyncClient()).attributes == (TAX,)

    async def test_it_asks_for_the_whole_dataflow(self) -> None:
        asked: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            asked.append(request)
            return httpx.Response(200, json=captured())

        await OecdAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond))).fetch(
            an_attribute(), [BELGIUM]
        )

        # Named directly: `stats.oecd.org` only redirects here, and `httpx` does not follow
        # redirects -- the first live run failed on exactly that.
        assert asked[0].url.path == "/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COMP@DF_TW_COMP/"
        assert asked[0].url.host == "sdmx.oecd.org"
        assert asked[0].url.params["format"] == "jsondata"
