"""The indicator codes, which are the one thing here a typo breaks silently.

A wrong code does not raise. The World Bank answers 200 with "The indicator was not found",
the adapter records one failure, and the run completes reporting that the World Bank had
nothing -- indistinguishable, from the outside, from a source that genuinely has nothing. These
tests pin the shape of the codes so the mistake has to get past something.
"""

import pytest

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
        """WGI publishes six dimensions; the catalog asks for three. An adapter offering the
        other three would be code written to be exported."""
        assert len(INDICATORS) == 3
