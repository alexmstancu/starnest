"""The indicator codes, which are the one thing here a typo breaks silently.

A wrong code does not raise. The World Bank answers 200 with "The indicator was not found",
the adapter records one failure, and the run completes reporting that the World Bank had
nothing -- indistinguishable, from the outside, from a source that genuinely has nothing. These
tests pin the shape of the codes so the mistake has to get past something.
"""

import pytest

from starnest.data import AttributeId
from starnest.data_sources.world_bank import INDICATORS, GovernanceIndicator, WorldBankAdapter


class TestTheIndicatorCodes:
    @pytest.mark.parametrize(
        ("attribute", "dimension"),
        [
            ("country.rule_of_law", "RL"),
            ("country.control_of_corruption", "CC"),
            ("country.political_economic_stability", "PV"),
        ],
    )
    def test_each_attribute_names_the_wgi_dimension_reqs_assigns_it(
        self, attribute: str, dimension: str
    ) -> None:
        assert INDICATORS[attribute].dimension == dimension

    def test_a_dimension_becomes_the_three_series_the_world_bank_publishes(self) -> None:
        indicator = GovernanceIndicator("RL")

        assert indicator.series == ("GOV_WGI_RL.EST", "GOV_WGI_RL.SR", "GOV_WGI_RL.SE")

    def test_an_indicator_says_which_dimension_it_is_when_printed(self) -> None:
        """It appears in failure messages and in a debugger, where "object at 0x..." is no help."""
        assert repr(GovernanceIndicator("RL")) == "GovernanceIndicator('RL')"


class TestWhatTheAdapterClaimsToBe:
    def test_it_names_the_data_source_row_the_catalog_actually_seeds(self) -> None:
        """`world_bank`, exactly. Every value points at this row and `attribute_source_priority`
        ranks it first for all three attributes -- a different string is a foreign key violation
        on insert, long after the fetch that produced it looked fine."""
        import httpx

        assert WorldBankAdapter(httpx.AsyncClient()).data_source == "world_bank"

    def test_it_offers_no_series_the_catalog_has_no_attribute_for(self) -> None:
        """WGI publishes six dimensions and the catalog asks for three; the WDI publishes
        thousands and the catalog asks for one. An adapter offering the rest would be code
        written to be exported.

        **A roster rather than a count.** The count was the assertion until forest cover joined,
        and a count says nothing about *which* series shipped -- it would pass with the wrong
        indicator code in place of the right one.
        """
        assert set(INDICATORS) == {
            "country.rule_of_law",
            "country.control_of_corruption",
            "country.political_economic_stability",
            "country.forest_cover",
        }

    def test_the_two_collections_are_asked_for_separately(self) -> None:
        """The WGI is not in the API's default databank and the WDI is, so the request has to
        say which -- asking databank 3 for forest cover answers a 200 carrying a refusal."""
        governance = INDICATORS[AttributeId("country.rule_of_law")]
        forest = INDICATORS[AttributeId("country.forest_cover")]

        assert governance.databank != forest.databank
        assert governance.publication == "World Bank WGI"
        assert forest.publication == "World Bank WDI"

    def test_a_measurement_published_alone_asks_for_one_series(self) -> None:
        """A WGI estimate ships with its source count and standard error because the publisher
        says how solid it is. Forest area carries no such series, and inventing one to keep the
        code symmetrical would claim an uncertainty the World Bank does not publish."""
        forest = INDICATORS[AttributeId("country.forest_cover")]

        assert forest.series == ("AG.LND.FRST.ZS",)
        assert forest.estimate == "AG.LND.FRST.ZS"
