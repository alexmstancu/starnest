"""The total tax rate estimated from Eurostat's figures, where OECD publishes none (Q207).

Seven captured slices: gross, taxes and employee contributions at 67% and at 167% of the
average wage, and the full wedge at 67%. The adapter backs the employer's rate out of the 67%
figures and applies it at 167%.

**What these tests cannot prove, and say so.** That the estimate is *right* was tested against
OECD before this was built -- within a point where employer contributions are flat, one to eight
off where they are capped or wage-dependent -- and that is why it ships at `low` confidence.
These tests prove the arithmetic is what that experiment measured, and that the rules around it
hold.
"""

import json
from decimal import Decimal
from pathlib import Path

import httpx

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, RatioParameters, ValueType
from starnest.data_sources.eurostat import TaxWedgeEstimateAdapter

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}
TAX = "country.total_tax_rate_effective"


def a_slice(request: httpx.Request) -> dict:
    """The captured response for whichever of the seven slices a request names."""
    if request.url.path.endswith("/earn_nt_taxwedge"):
        return json.loads((CAPTURED / "earn_nt_taxwedge.json").read_text())
    case = {"P1_NCH_AW67": "aw67", "P1_NCH_AW167": "aw167"}[request.url.params["ecase"]]
    part = request.url.params["estruct"]
    return json.loads((CAPTURED / f"earn_nt_net_{case}_{part}.json").read_text())


def an_adapter(alter=None) -> TaxWedgeEstimateAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        body = a_slice(request)
        if alter is not None:
            alter(request, body)
        return httpx.Response(200, json=body)

    return TaxWedgeEstimateAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


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


def a_country(name: str, code: str | None) -> Candidate:
    return Candidate(id=f"country.{name}", name=name.title(), level=COUNTRY, country_code=code)


ROMANIA = a_country("romania", "RO")


class TestTheEstimate:
    async def test_romania_comes_out_where_the_experiment_measured_it(self) -> None:
        acquired = await an_adapter().fetch(an_attribute(), [ROMANIA])

        assert round(acquired.values[0].payload.value, 1) == Decimal("42.8")

    async def test_the_employer_rate_it_backs_out_is_romanias_statutory_one(self) -> None:
        """2.25% since 2018, recovered from Eurostat's figures with no rate typed in -- the
        corroboration that the method holds where contributions are flat."""
        acquired = await an_adapter().fetch(an_attribute(), [ROMANIA])

        assert "are 2.3% of gross" in acquired.values[0].quote

    async def test_it_is_low_confidence_under_its_own_source(self) -> None:
        """So the screen says "estimate" wherever it is shown, and OECD outranks it."""
        stored = (await an_adapter().fetch(an_attribute(), [ROMANIA])).values[0]

        assert stored.confidence_level is ConfidenceLevel.LOW
        assert stored.data_source == "eurostat_estimate"
        assert stored.payload.basis == "labour_cost"

    async def test_the_provenance_carries_the_working_and_the_caveat(self) -> None:
        quote = (await an_adapter().fetch(an_attribute(), [ROMANIA])).values[0].quote

        assert "backed out of the" in quote
        assert "Approximate where contributions are capped" in quote

    async def test_greece_is_asked_for_by_eurostats_own_code(self) -> None:
        """Greece is `EL` at Eurostat; the candidate carries ISO's `GR`."""
        acquired = await an_adapter().fetch(an_attribute(), [a_country("greece", "GR")])

        assert acquired.values, "Greece must be found under EL"


class TestTheSevenSeriesMustAgreeOnTheYear:
    async def test_a_year_missing_from_any_one_series_is_not_used(self) -> None:
        """Remove Romania's 2025 figure from the 67% wedge alone. Every other series still has
        2025, and the estimate falls back to 2024 -- the newest year all seven share."""

        def drop_the_wedges_2025(request: httpx.Request, body: dict) -> None:
            if request.url.path.endswith("/earn_nt_taxwedge"):
                _drop(body, geo="RO", period="2025")

        acquired = await an_adapter(drop_the_wedges_2025).fetch(an_attribute(), [ROMANIA])

        assert acquired.values[0].reference_period.start.year == 2024


class TestWhatItRefuses:
    async def test_a_country_missing_a_series_entirely_gets_no_value(self) -> None:
        """Liechtenstein is in none of them. A gap, not a failure."""
        acquired = await an_adapter().fetch(an_attribute(), [a_country("liechtenstein", "LI")])

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_an_impossible_employer_rate_is_a_failure_rather_than_a_number(self) -> None:
        """Push the 67% wedge below what the employee alone pays, and the employer's backed-out
        share goes negative. No contribution system does that, so the series disagree and no
        estimate is made -- rather than a figure that looks like a low tax rate."""

        def an_implausibly_low_wedge(request: httpx.Request, body: dict) -> None:
            if request.url.path.endswith("/earn_nt_taxwedge"):
                geos = body["dimension"]["geo"]["category"]["index"]
                times = body["dimension"]["time"]["category"]["index"]
                for period in times:
                    index = str(geos["RO"] * len(times) + times[period])
                    if index in body["value"]:
                        body["value"][index] = 1.0

        acquired = await an_adapter(an_implausibly_low_wedge).fetch(an_attribute(), [ROMANIA])

        assert acquired.values == ()
        assert "no contribution system produces" in acquired.failures[0].reason

    async def test_a_candidate_with_no_country_code_is_reported(self) -> None:
        acquired = await an_adapter().fetch(an_attribute(), [a_country("atlantis", None)])

        assert "no country code" in acquired.failures[0].reason

    async def test_it_answers_only_the_total_tax_rate(self) -> None:
        acquired = await an_adapter().fetch(an_attribute(id="country.press_freedom"), [ROMANIA])

        assert "answers only" in acquired.failures[0].reason

    async def test_an_unreachable_eurostat_is_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        adapter = TaxWedgeEstimateAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert "no route" in (await adapter.fetch(an_attribute(), [ROMANIA])).failures[0].reason

    async def test_an_unreadable_response_is_a_failure(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"not": "json-stat"})

        adapter = TaxWedgeEstimateAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        assert (await adapter.fetch(an_attribute(), [ROMANIA])).failures


class TestWhatTheAdapterClaimsToBe:
    def test_it_reports_its_own_source_not_eurostats(self) -> None:
        """An estimate filed under `eurostat` would read as Eurostat's own figure."""
        adapter = TaxWedgeEstimateAdapter(httpx.AsyncClient())

        assert adapter.data_source == "eurostat_estimate"
        assert adapter.attributes == (TAX,)


def _drop(document: dict, *, geo: str, period: str) -> None:
    geos = document["dimension"]["geo"]["category"]["index"]
    times = document["dimension"]["time"]["category"]["index"]
    index = str(geos[geo] * len(times) + times[period])
    assert index in document["value"], "the fixture must hold the figure being dropped"
    del document["value"][index]
