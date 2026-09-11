"""Eurostat's cube becoming stored values, against responses captured from the live API.

The adapter is driven through a stub transport rather than the network: a test that reaches
Eurostat fails when Eurostat is down, which says nothing about this code. The bytes are real --
`captured/` holds what the API actually returned -- so the parsing, the geo mapping and the
choice of year are all exercised against the shape that exists rather than one imagined.

**The rule these tests defend above the others**: a country Eurostat has nothing for produces
no value. Not a zero, not last year's figure, not a neighbour's. Every gap here becomes a
coverage percentage in the ranking, which is the number `reqs.md` 5.3 exists to make visible.
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
    QuantityParameters,
    RatioParameters,
    ValueType,
)
from starnest.data_sources.eurostat import EurostatAdapter

CAPTURED = Path(__file__).parent / "captured"
COUNTRY = {"id": "country", "depth_order": 1}

OVERBURDEN = "country.housing_cost_overburden_rate"
LIFE_SATISFACTION = "country.life_satisfaction"


def an_attribute(**overrides: object) -> Attribute:
    fields: dict[str, object] = {
        "id": OVERBURDEN,
        "name": "Housing cost overburden rate",
        "level": "country",
        "value_type": ValueType.RATIO,
        "pillar": "housing",
        "ratio_parameters": RatioParameters(basis="households"),
    }
    return Attribute(**(fields | overrides))  # type: ignore[arg-type]


def a_country(name: str, code: str | None) -> Candidate:
    return Candidate(id=f"country.{name}", name=name.title(), level=COUNTRY, country_code=code)


def adapter_returning(dataset: str) -> EurostatAdapter:
    """An adapter whose every request is answered with one captured response."""
    body = json.loads((CAPTURED / f"{dataset}.json").read_text())

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


def adapter_that_fails(status: int) -> EurostatAdapter:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": "no"})

    return EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))


class TestWhatComesBackFromARealResponse:
    async def test_a_country_that_reported_gets_a_value_with_its_own_figure(self) -> None:
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

        (value,) = acquired.values
        assert value.payload.value == Decimal("6.3")
        assert value.candidate == "country.portugal"
        assert value.data_source == "eurostat"

    async def test_the_figure_is_the_most_recent_year_that_country_reported(self) -> None:
        """Per country, not per dataset. Eurostat publishes on its own timetable, and taking a
        single latest year for the whole response would drop everyone who had not filed yet."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

        # Portugal's newest figure in the captured response is 2025, not the 2024 one that
        # 35 countries share -- which is exactly the case this rule exists for.
        (value,) = acquired.values
        assert value.reference_period.start == date(2025, 1, 1)
        assert value.reference_period.end == date(2025, 12, 31)

    async def test_the_two_dates_are_kept_apart(self) -> None:
        """The reference period is what the figure describes; the retrieval date is when we
        fetched it. Merging them would make a 2019 figure fetched today look current."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

        (value,) = acquired.values
        assert value.retrieval_date.date() > value.reference_period.end
        assert value.retrieval_date.tzinfo is not None

    async def test_eurostats_own_code_for_greece_is_translated(self) -> None:
        """Eurostat writes EL, ISO writes GR. The candidate stores the standard and the
        adapter knows the deviation."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("greece", "GR")]
        )

        (value,) = acquired.values
        assert value.payload.value == Decimal("26.4")

    async def test_most_of_the_candidate_set_gets_a_figure(self) -> None:
        """The point of choosing Eurostat: it covers the places we are actually ranking."""
        countries = [
            a_country(name, code)
            for name, code in (
                ("portugal", "PT"),
                ("spain", "ES"),
                ("germany", "DE"),
                ("france", "FR"),
                ("italy", "IT"),
                ("greece", "GR"),
                ("ireland", "IE"),
                ("austria", "AT"),
            )
        ]

        acquired = await adapter_returning("ilc_lvho07a").fetch(an_attribute(), countries)

        assert len(acquired.values) == len(countries)
        assert not acquired.failures


class TestTheGapsAreLeftAsGaps:
    async def test_a_country_the_response_has_nothing_for_produces_no_value(self) -> None:
        """Not a zero, not a neighbour's figure. The gap becomes coverage downstream."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", "PT"), a_country("andorra", "AD")]
        )

        assert [str(value.candidate) for value in acquired.values] == ["country.portugal"]

    async def test_a_missing_country_is_not_reported_as_a_failure(self) -> None:
        """Sparse coverage is the ordinary state of an indicator, not an error. Reporting it as
        one would bury the failures that are actually actionable."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("andorra", "AD")]
        )

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_a_candidate_with_no_country_code_is_a_failure_that_is_reported(self) -> None:
        """This one IS actionable: the catalog is missing a code we could supply."""
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", None)]
        )

        (failure,) = acquired.failures
        assert failure.candidate == "country.portugal"
        assert "no country code" in failure.reason


class TestThePayloadTakesTheShapeTheCatalogDeclares:
    async def test_a_ratio_attribute_carries_the_basis_from_the_catalog(self) -> None:
        """A basis the real catalog does not use, on purpose.

        Asserting `households` -- which is what `reqs.md` 7.1 actually declares -- would pass
        just as well against an adapter that wrote the word in itself, so the test would prove
        nothing about where the value came from. This one fails unless it was read.
        """
        counted_differently = an_attribute(ratio_parameters=RatioParameters(basis="dwellings"))

        acquired = await adapter_returning("ilc_lvho07a").fetch(
            counted_differently, [a_country("portugal", "PT")]
        )

        (value,) = acquired.values
        assert value.payload.basis == "dwellings"

    async def test_a_quantity_attribute_carries_the_unit_from_the_catalog(self) -> None:
        """Nothing about ladder points is written in the adapter: it is read off the
        attribute, so adding an attribute of an existing type stays a data change."""
        satisfaction = an_attribute(
            id=LIFE_SATISFACTION,
            name="Life satisfaction",
            value_type=ValueType.QUANTITY,
            pillar="culture",
            ratio_parameters=None,
            quantity_parameters=QuantityParameters(unit="ladder_points"),
        )

        acquired = await adapter_returning("ilc_pw01").fetch(
            satisfaction, [a_country("portugal", "PT")]
        )

        (value,) = acquired.values
        assert value.payload.unit == "ladder_points"
        assert value.payload.magnitude > 0


class TestConfidenceFollowsEurostatsOwnFlag:
    async def test_an_unflagged_figure_from_an_official_agency_is_high(self) -> None:
        acquired = await adapter_returning("ilc_lvho07a").fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

        (value,) = acquired.values
        assert value.confidence_level is ConfidenceLevel.HIGH

    async def test_a_figure_its_publisher_marks_provisional_is_medium(self) -> None:
        """Eurostat's judgement read off, never ours invented. A figure the publisher has not
        settled should not be presented as settled (`reqs.md` 5.7)."""
        flagged = json.loads((CAPTURED / "ilc_lvho07a.json").read_text())
        newest_for_portugal = str(
            flagged["dimension"]["geo"]["category"]["index"]["PT"] * flagged["size"][-1]
            + flagged["dimension"]["time"]["category"]["index"]["2025"]
        )
        flagged["status"] = {newest_for_portugal: "p"}

        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=flagged)

        adapter = EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        acquired = await adapter.fetch(an_attribute(), [a_country("portugal", "PT")])

        (value,) = acquired.values
        assert value.confidence_level is ConfidenceLevel.MEDIUM


class TestWhenTheSourceCannotAnswer:
    async def test_an_http_error_is_recorded_rather_than_raised(self) -> None:
        """A run completes for everything that works and records what did not (`reqs.md` 6.4).
        Sparse coverage makes routine failure the norm, so aborting would mean never finishing
        a run."""
        acquired = await adapter_that_fails(503).fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

        assert acquired.values == ()
        (failure,) = acquired.failures
        assert failure.attribute == OVERBURDEN

    async def test_a_response_that_is_not_a_cube_is_recorded_rather_than_raised(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"nothing": "useful"})

        adapter = EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

        acquired = await adapter.fetch(an_attribute(), [a_country("portugal", "PT")])

        assert acquired.values == ()
        assert acquired.failures

    async def test_an_attribute_this_source_does_not_publish_is_refused(self) -> None:
        """Asking is the caller's mistake, and saying so beats returning an empty result that
        looks like a country nobody reported for."""
        unknown = an_attribute(
            id="country.press_freedom", name="Press freedom", pillar="governance"
        )

        acquired = await adapter_returning("ilc_lvho07a").fetch(
            unknown, [a_country("portugal", "PT")]
        )

        (failure,) = acquired.failures
        assert "publishes no series" in failure.reason


class TestTheTwoSeriesP4Added:
    """W4-F: `tech_employment_share` and `broadband_coverage`, against captured responses.

    They earn their place by opening pillars rather than deepening one -- career and
    connectivity had no figures at all, while housing already had two of its three
    (`devplan.md` D7). Both are Ratios, so they run the same payload path the first three
    proved; what is new is the datasets, and a dataset code is the one thing here a typo breaks
    silently.
    """

    TECH = "country.tech_employment_share"
    BROADBAND = "country.broadband_coverage"

    async def test_ict_specialists_arrive_as_a_share_of_the_workforce(self) -> None:
        acquired = await adapter_returning("isoc_sks_itspt").fetch(
            an_attribute(
                id=self.TECH,
                value_type=ValueType.RATIO,
                pillar="career",
                ratio_parameters=RatioParameters(basis="workforce"),
            ),
            [a_country("portugal", "PT"), a_country("romania", "RO")],
        )

        figures = {v.candidate: v.payload.value for v in acquired.values}
        assert figures["country.portugal"] == Decimal("5.4")
        assert figures["country.romania"] == Decimal("2.7")
        assert {v.payload.basis for v in acquired.values} == {"workforce"}

    async def test_broadband_coverage_arrives_as_a_share_of_households(self) -> None:
        acquired = await adapter_returning("isoc_cbs").fetch(
            an_attribute(
                id=self.BROADBAND,
                value_type=ValueType.RATIO,
                pillar="connectivity",
                ratio_parameters=RatioParameters(basis="households"),
            ),
            [a_country("greece", "GR"), a_country("portugal", "PT")],
        )

        figures = {v.candidate: v.payload.value for v in acquired.values}
        # Greece is the spread this threshold exists to show: 80.5 against Portugal's 97.2.
        assert figures["country.greece"] == Decimal("80.5")
        assert figures["country.portugal"] == Decimal("97.2")

    async def test_a_country_that_stopped_reporting_keeps_its_last_real_year(self) -> None:
        """**The rule the whole "fetch the series, not the last period" decision rests on.**

        Every country in this dataset reports 2025 except the United Kingdom, whose newest
        figure is 2019. Asking Eurostat for the recent periods would have returned a smaller
        response and no United Kingdom at all -- a quieter request buying a worse answer. The
        reference period says 2019, so the figure is visibly old rather than silently current.
        """
        acquired = await adapter_returning("isoc_sks_itspt").fetch(
            an_attribute(
                id=self.TECH,
                value_type=ValueType.RATIO,
                pillar="career",
                ratio_parameters=RatioParameters(basis="workforce"),
            ),
            [a_country("united_kingdom", "GB"), a_country("germany", "DE")],
        )

        years = {v.candidate: v.reference_period.end.year for v in acquired.values}
        assert years["country.united_kingdom"] == 2019
        assert years["country.germany"] == 2025

    async def test_protected_land_arrives_as_a_share_of_territory(self) -> None:
        acquired = await adapter_returning("sdg_15_20").fetch(
            an_attribute(
                id="country.protected_land_share",
                value_type=ValueType.RATIO,
                pillar="nature",
                ratio_parameters=RatioParameters(basis="territory"),
            ),
            [a_country("germany", "DE"), a_country("romania", "RO")],
        )

        figures = {v.candidate: v.payload.value for v in acquired.values}
        assert figures["country.germany"] == Decimal("39.1")
        assert figures["country.romania"] == Decimal("23.5")

    async def test_the_price_level_arrives_with_the_eu_average_as_its_unit(self) -> None:
        """The attribute that could hold no value at all until `0443` retyped it.

        The figures are why `Index` was wrong: Romania 65.1 and Iceland 173.5 on a scale whose
        middle is 100 and whose top does not exist. Any bound wide enough to hold Iceland would
        have been a number nobody published.
        """
        acquired = await adapter_returning("tec00120").fetch(
            an_attribute(
                id="country.cost_of_living_index",
                value_type=ValueType.QUANTITY,
                pillar="economics",
                ratio_parameters=None,
                quantity_parameters=QuantityParameters(unit="eu27_average_100"),
            ),
            [a_country("romania", "RO"), a_country("iceland", "IS")],
        )

        figures = {v.candidate: v.payload.magnitude for v in acquired.values}
        assert figures["country.romania"] == Decimal("65.1")
        assert figures["country.iceland"] == Decimal("173.5")
        assert figures["country.iceland"] > 100, "the EU average is the middle, not the top"

    async def test_the_homicide_rate_arrives_per_hundred_thousand(self) -> None:
        """`0442` created this attribute out of `crime_safety_index`, whose rank-1 source was a
        portal download and whose bounds were behind a subscription. Eurostat was rank 2 all
        along and answers all 32."""
        acquired = await adapter_returning("sdg_16_10").fetch(
            an_attribute(
                id="country.homicide_rate",
                value_type=ValueType.QUANTITY,
                pillar="safety",
                # The helper defaults to a Ratio; an attribute may declare parameters for one
                # type only, so the default is cleared rather than joined.
                ratio_parameters=None,
                quantity_parameters=QuantityParameters(unit="per_100000_population"),
            ),
            [a_country("romania", "RO"), a_country("germany", "DE")],
        )

        figures = {v.candidate: v.payload.magnitude for v in acquired.values}
        assert figures["country.romania"] == Decimal("1.12")
        assert figures["country.germany"] == Decimal("0.41")
        assert {v.payload.unit for v in acquired.values} == {"per_100000_population"}

    async def test_the_five_countries_outside_the_eu_series_are_coverage_not_failures(
        self,
    ) -> None:
        """`sdg_15_20` is built on EU reporting, so Switzerland, Iceland, Liechtenstein, Norway
        and the United Kingdom are simply not in it.

        **That gap must arrive as coverage rather than as an error**, because it is neither a
        broken fetch nor something anybody can fix -- and a ranking that quietly filled it from
        another measurement would be presenting two different things as one (`reqs.md` 5.3).
        """
        outside = ["switzerland", "iceland", "liechtenstein", "norway", "united_kingdom"]
        codes = ["CH", "IS", "LI", "NO", "GB"]

        acquired = await adapter_returning("sdg_15_20").fetch(
            an_attribute(
                id="country.protected_land_share",
                value_type=ValueType.RATIO,
                pillar="nature",
                ratio_parameters=RatioParameters(basis="territory"),
            ),
            [a_country(name, code) for name, code in zip(outside, codes, strict=True)],
        )

        assert acquired.values == ()
        assert acquired.failures == ()

    async def test_liechtenstein_is_absent_from_both_and_gets_no_value(self) -> None:
        """Eurostat does not survey it. That gap is coverage, and the World Bank is what fills
        the ranking's picture of it (`data_sources/world_bank`)."""
        for dataset, attribute, basis in (
            ("isoc_sks_itspt", self.TECH, "workforce"),
            ("isoc_cbs", self.BROADBAND, "households"),
        ):
            acquired = await adapter_returning(dataset).fetch(
                an_attribute(
                    id=attribute,
                    value_type=ValueType.RATIO,
                    pillar="career",
                    ratio_parameters=RatioParameters(basis=basis),
                ),
                [a_country("liechtenstein", "LI")],
            )

            assert acquired.values == ()
            assert acquired.failures == ()


def test_the_adapter_declares_only_the_attributes_it_can_answer() -> None:
    """Declared rather than discovered, so a run can be planned and asking for something this
    source does not publish is a question that cannot be posed."""
    attributes = EurostatAdapter(httpx.AsyncClient()).attributes

    assert OVERBURDEN in attributes
    assert "country.press_freedom" not in attributes


@pytest.mark.live
async def test_the_live_api_still_answers_the_shape_we_parse() -> None:
    """Excluded from `make test`. The captured fixtures are what the unit tests read; this is
    what tells us they have gone stale."""
    async with httpx.AsyncClient(timeout=30) as client:
        acquired = await EurostatAdapter(client).fetch(
            an_attribute(), [a_country("portugal", "PT")]
        )

    assert acquired.values, "Eurostat no longer answers the query the manifest describes"


class TestAShareAssembledFromComponents:
    """`income_tax_effective`: taxes plus social contributions over gross earnings.

    Eurostat publishes the three separately in `earn_nt_net`, so the adapter fetches each as
    its own slice and divides. These tests use the three captured slices, answered by which
    `estruct` each request names.
    """

    TAX = "country.income_tax_effective"

    @staticmethod
    def an_adapter(**replaced: object) -> EurostatAdapter:
        """Answers each component request with its captured slice, or with a replacement."""
        bodies = {
            part: replaced.get(part)
            or json.loads((CAPTURED / f"earn_nt_net_{part}.json").read_text())
            for part in ("GRS", "TAX", "SOC")
        }

        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=bodies[request.url.params["estruct"]])

        return EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

    def an_attribute(self) -> Attribute:
        return an_attribute(
            id=self.TAX,
            pillar="economics",
            ratio_parameters=RatioParameters(basis="gross_income"),
        )

    async def test_the_rate_is_the_parts_over_the_whole(self) -> None:
        """Romania: 1541.93 tax + 8302.71 social security of 23722.04 gross is 41.5%, which is
        what Romanian law gives -- 35% contributions, then 10% income tax on the remainder."""
        acquired = await self.an_adapter().fetch(self.an_attribute(), [a_country("romania", "RO")])

        rate = acquired.values[0].payload.value
        assert round(rate, 1) == Decimal("41.5")
        assert acquired.values[0].payload.basis == "gross_income"

    async def test_the_provenance_shows_the_working_not_just_the_answer(self) -> None:
        """A derived figure owes the reader its arithmetic (`reqs.md` 3.6)."""
        acquired = await self.an_adapter().fetch(self.an_attribute(), [a_country("romania", "RO")])

        quote = acquired.values[0].quote
        assert "TAX 1541.93 + SOC 8302.71 of GRS 23722.04 = 41.5%" in quote
        assert quote.startswith("Eurostat earn_nt_net 2025:")

    async def test_a_country_that_stopped_reporting_keeps_its_last_complete_year(self) -> None:
        """The United Kingdom's newest complete year is 2019. It is used as 2019, visibly."""
        acquired = await self.an_adapter().fetch(
            self.an_attribute(), [a_country("united_kingdom", "GB")]
        )

        assert acquired.values[0].reference_period.end.year == 2019

    async def test_components_from_different_years_are_never_divided(self) -> None:
        """**The rule that would otherwise fail silently.** Remove Romania's 2025 gross earnings
        and its 2025 taxes have nothing of their own year to be divided by: the rate falls back
        to 2024, the newest year all three share.

        **The figure is asserted, not only the year**, because a first version of this test
        checked the year alone and a mutation dividing 2025 taxes by 2024 earnings -- labelled
        2024 -- passed it. That misaligned rate is 45.1%; the real 2024 rate is 41.5%, the same
        as 2025 because Romania's system is flat. A plausible number, 3.6 points wrong,
        describing no year that ever existed.
        """
        gross = json.loads((CAPTURED / "earn_nt_net_GRS.json").read_text())
        _drop(gross, geo="RO", period="2025")

        acquired = await self.an_adapter(GRS=gross).fetch(
            self.an_attribute(), [a_country("romania", "RO")]
        )

        assert acquired.values[0].reference_period.end.year == 2024
        assert round(acquired.values[0].payload.value, 1) == Decimal("41.5")

    async def test_liechtenstein_is_absent_from_all_three_and_gets_no_value(self) -> None:
        acquired = await self.an_adapter().fetch(
            self.an_attribute(), [a_country("liechtenstein", "LI")]
        )

        assert acquired.values == ()
        assert acquired.failures == ()


def _drop(document: dict, *, geo: str, period: str) -> None:
    """Remove one observation from a captured JSON-stat response, as if never published.

    The cube is flat and row-major, so the observation's index is computed from its position
    on the geo and time axes; every other dimension in these slices has one category.
    """
    geos = document["dimension"]["geo"]["category"]["index"]
    times = document["dimension"]["time"]["category"]["index"]
    index = geos[geo] * len(times) + times[period]
    assert str(index) in document["value"], "the fixture must hold the figure being dropped"
    del document["value"][str(index)]


class TestADensityAcrossTwoDatasets:
    """`rail_network_density` and `road_network_quality`: a length per 1,000 km² of land.

    Eurostat publishes the length (`rail_if_line_tr`, `road_if_motorwa`) and the land area
    (`reg_area3`) separately, so the adapter fetches both and divides. These tests answer each
    request from its own captured response, told apart by the dataset in the URL.
    """

    RAIL = "country.rail_network_density"
    MOTORWAYS = "country.road_network_quality"

    @staticmethod
    def an_adapter(**replaced: object) -> EurostatAdapter:
        bodies = {
            dataset: replaced.get(dataset) or json.loads((CAPTURED / f"{dataset}.json").read_text())
            for dataset in ("rail_if_line_tr", "road_if_motorwa", "reg_area3")
        }

        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=bodies[request.url.path.rsplit("/", 1)[-1]])

        return EurostatAdapter(httpx.AsyncClient(transport=httpx.MockTransport(respond)))

    def an_attribute(self, identifier: str = RAIL) -> Attribute:
        return an_attribute(
            id=identifier,
            pillar="connectivity",
            value_type=ValueType.QUANTITY,
            ratio_parameters=None,
            quantity_parameters=QuantityParameters(unit="km_per_1000_km2"),
        )

    async def test_the_figure_is_the_length_per_thousand_square_kilometres_of_land(self) -> None:
        """Austria 2024: 5,624 km of railway over 82,494 km² of land."""
        (value,) = (
            await self.an_adapter().fetch(self.an_attribute(), [a_country("austria", "AT")])
        ).values

        assert value.payload.magnitude == pytest.approx(Decimal(5624) / Decimal(82494) * 1000)
        assert value.payload.unit == "km_per_1000_km2"

    async def test_the_period_is_the_lengths_own_year(self) -> None:
        """Germany's newest railway length is 2021; the area is a stable denominator and is
        taken at its newest, so the figure describes 2021 -- the year the length was measured."""
        (value,) = (
            await self.an_adapter().fetch(self.an_attribute(), [a_country("germany", "DE")])
        ).values

        assert value.reference_period.start == date(2021, 1, 1)

    async def test_the_quote_shows_both_figures_and_both_years(self) -> None:
        (value,) = (
            await self.an_adapter().fetch(self.an_attribute(), [a_country("austria", "AT")])
        ).values

        assert value.quote is not None
        assert "rail_if_line_tr 2024: 5624" in value.quote
        assert "reg_area3" in value.quote
        assert "82494" in value.quote

    async def test_a_country_with_no_published_length_gets_no_value_not_a_zero(self) -> None:
        """Cyprus has no railway, and Eurostat publishes nothing rather than 0. Writing the 0
        ourselves would be the adapter inventing a figure; a manual value with a citation is
        the honest way to record it."""
        acquired = await self.an_adapter().fetch(self.an_attribute(), [a_country("cyprus", "CY")])

        assert acquired.values == ()

    async def test_a_published_zero_is_a_figure(self) -> None:
        """Latvia reports 0 km of motorway. That is a measurement, and it scores."""
        (value,) = (
            await self.an_adapter().fetch(
                self.an_attribute(self.MOTORWAYS), [a_country("latvia", "LV")]
            )
        ).values

        assert value.payload.magnitude == 0

    async def test_a_country_with_no_area_gets_no_value(self) -> None:
        empty_area = json.loads((CAPTURED / "reg_area3.json").read_text())
        empty_area["value"] = {}

        acquired = await self.an_adapter(reg_area3=empty_area).fetch(
            self.an_attribute(), [a_country("austria", "AT")]
        )

        assert acquired.values == ()

    async def test_an_area_of_zero_gives_no_value_rather_than_a_division_by_zero(self) -> None:
        zero_area = json.loads((CAPTURED / "reg_area3.json").read_text())
        zero_area["value"] = dict.fromkeys(zero_area["value"], 0)

        acquired = await self.an_adapter(reg_area3=zero_area).fetch(
            self.an_attribute(), [a_country("austria", "AT")]
        )

        assert acquired.values == ()


class TestWorkingHours:
    async def test_the_usual_full_time_week_of_employees(self) -> None:
        """`lfsa_ewhun2`: usual hours, full-time employees aged 20-64 -- the week a household
        moving for work would actually be offered. Total hours would count part-timers, and
        the Netherlands would look like a four-day country."""
        acquired = await adapter_returning("lfsa_ewhun2").fetch(
            an_attribute(
                id="country.average_working_hours",
                pillar="career",
                value_type=ValueType.QUANTITY,
                ratio_parameters=None,
                quantity_parameters=QuantityParameters(unit="hours_per_week"),
            ),
            [a_country("germany", "DE")],
        )

        (value,) = acquired.values
        assert value.payload.magnitude == Decimal("39.8")
