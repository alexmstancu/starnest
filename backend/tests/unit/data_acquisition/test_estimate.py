"""Estimating a spend before it happens (`reqs.md` 6.3).

**The estimate and the cap are different mechanisms on purpose** (Q22): this is arithmetic over
a plan, `spend.py` is arithmetic over what happened. The estimate catches a mistake before it is
paid for, and the cap catches whatever the estimate got wrong -- so an estimate being an
approximation is by design, and what matters is that it says so.
"""

from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import Attribute, AttributeId, DataSourceId
from starnest.data_acquisition import NOTHING, Acquired, Estimate, SourceAdapter


class TestAddingEstimates:
    def test_the_calls_and_the_money_both_add_up(self) -> None:
        together = Estimate(calls=3, cost_eur=Decimal("0.30")) + Estimate(
            calls=2, cost_eur=Decimal("0.20")
        )

        assert together.calls == 5
        assert together.cost_eur == Decimal("0.50")

    def test_one_shared_basis_is_stated_once(self) -> None:
        """Two adapters over one model share one set of assumptions, and repeating it would read
        as two different ones."""
        same = "a ceiling of 10,000 input tokens a call"

        together = Estimate(calls=1, basis=same) + Estimate(calls=1, basis=same)

        assert together.basis == same

    def test_two_different_bases_are_both_kept(self) -> None:
        together = Estimate(basis="the model's ceiling") + Estimate(basis="a flat rate per page")

        assert together.basis == "the model's ceiling; a flat rate per page"

    def test_nothing_adds_nothing_and_explains_nothing(self) -> None:
        """A run over free sources reports zero with no basis: there is nothing to explain about
        zero, and a sentence about assumptions would imply the figure rests on some."""
        priced = Estimate(calls=4, cost_eur=Decimal("1.00"), basis="the model's ceiling")

        together = NOTHING + priced + NOTHING

        assert together == priced

    def test_an_estimate_of_nothing_is_the_default(self) -> None:
        assert Estimate(calls=0, cost_eur=Decimal(0), basis="") == NOTHING


class _AFreeSource(SourceAdapter):
    """A structured source, written the way all seven are: it never mentions money."""

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId("eurostat")

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (AttributeId("country.overcrowding_rate"),)

    async def fetch(self, attribute: Attribute, candidates: list[Candidate]) -> Acquired:  # type: ignore[override]
        return Acquired()


class TestWhatASourceEstimatesByDefault:
    def test_a_source_that_says_nothing_about_money_estimates_nothing(self) -> None:
        """**The same default as `costs_money`, for the same reason.** Every structured source is
        free, and a source that charges has to say so rather than be assumed harmless."""
        source = _AFreeSource()

        assert source.costs_money is False
        assert source.estimate_for(1_000) == NOTHING

    def test_the_two_defaults_agree(self) -> None:
        """A source that charges and estimates nothing would report a paid run as free.

        Asserted over the *shipped* registry in `test_composition_root.py`, where it is a fact
        about this application rather than about a class written by a test. Here it is only the
        agreement of the two defaults: nothing charges, so nothing is estimated.
        """
        source = _AFreeSource()

        assert (source.estimate_for(1).calls > 0) is source.costs_money
