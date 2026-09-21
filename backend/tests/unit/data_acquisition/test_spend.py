"""What a run is allowed to cost (`reqs.md` 6.3).

**Every source shipped today is free, and that is why this is tested now rather than later.** The
LLM path is the first thing that can spend money, and a cap decided after the first surprising
bill is not a cap.
"""

from decimal import Decimal

import pytest

from starnest.data import DataSource, DataSourceId, ReliabilityTierId, SourceKind
from starnest.data_acquisition import CostMeter, SpendCapNotSetError, refuse_unless_capped
from starnest.data_acquisition.adapter import SourceAdapter
from starnest.data_acquisition.execution import asked_this_run, switched_on


class TestTheMeter:
    def test_it_accumulates_what_each_call_cost(self) -> None:
        meter = CostMeter(cap_eur=Decimal(5))

        meter.spent(cost_eur=Decimal("1.25"))
        meter.spent(cost_eur=Decimal("0.75"), calls=2)

        assert meter.spent_eur == Decimal(2)
        assert meter.calls == 3

    def test_it_is_exhausted_at_the_cap_and_not_before(self) -> None:
        meter = CostMeter(cap_eur=Decimal(2))

        meter.spent(cost_eur=Decimal("1.99"))
        assert not meter.is_exhausted

        meter.spent(cost_eur=Decimal("0.01"))
        assert meter.is_exhausted

    def test_an_uncapped_run_is_never_exhausted(self) -> None:
        """Accepted deliberately, so nothing stops it: that is what the acceptance means."""
        meter = CostMeter(cap_eur=None)

        meter.spent(cost_eur=Decimal(1000))

        assert not meter.is_exhausted
        assert meter.remaining_eur is None

    def test_what_remains_never_goes_negative(self) -> None:
        """A negative remainder reads as a debt rather than a stop."""
        meter = CostMeter(cap_eur=Decimal(1))

        meter.spent(cost_eur=Decimal(3))

        assert meter.remaining_eur == Decimal(0)

    def test_it_describes_itself_for_the_log(self) -> None:
        """So a halt is never a surprise (`arch.md` 9.4)."""
        meter = CostMeter(cap_eur=Decimal(5))
        meter.spent(cost_eur=Decimal(1))

        assert "1 of 5 EUR" in meter.describe()
        assert "4 remaining" in meter.describe()

    def test_an_uncapped_meter_says_so_rather_than_showing_a_blank(self) -> None:
        assert "no cap set" in CostMeter(cap_eur=None).describe()


class TestWhenARunIsRefused:
    def test_a_paid_run_with_no_cap_is_refused(self) -> None:
        with pytest.raises(SpendCapNotSetError, match="no spend cap is set"):
            refuse_unless_capped(costs_money=True, cap_eur=None, uncapped_is_accepted=False)

    def test_the_refusal_says_both_ways_out(self) -> None:
        """Set the cap, or accept an uncapped run. A refusal with no way past it is a wall."""
        with pytest.raises(SpendCapNotSetError) as refusal:
            refuse_unless_capped(costs_money=True, cap_eur=None, uncapped_is_accepted=False)

        assert "run_spend_cap_eur" in str(refusal.value)
        assert "accept an uncapped run" in str(refusal.value)

    def test_a_paid_run_with_a_cap_proceeds(self) -> None:
        refuse_unless_capped(costs_money=True, cap_eur=Decimal(5), uncapped_is_accepted=False)

    def test_a_paid_run_the_household_accepted_uncapped_proceeds(self) -> None:
        """The bypass asked for: refused by default, allowed when somebody says so in the
        request. Not a setting, and not remembered."""
        refuse_unless_capped(costs_money=True, cap_eur=None, uncapped_is_accepted=True)

    def test_a_free_run_is_never_refused(self) -> None:
        """Six of the seven sources cost nothing, and a cap is meaningless to them."""
        refuse_unless_capped(costs_money=False, cap_eur=None, uncapped_is_accepted=False)


class _Source(SourceAdapter):
    def __init__(self, *, source: str, charges: bool) -> None:
        self._source = source
        self._charges = charges

    @property
    def data_source(self):  # type: ignore[no-untyped-def]
        return self._source

    @property
    def costs_money(self) -> bool:
        return self._charges

    @property
    def attributes(self) -> tuple:
        return ()

    async def fetch(self, attribute, candidates):  # type: ignore[no-untyped-def]
        raise AssertionError("not asked in these tests")


class TestWhichSourcesARunAsks:
    """A paid source is asked only when the run names the attributes it wants.

    An unscoped sweep over a level asks the free sources for whole indicators and costs nothing.
    The same sweep through a paid source would be hundreds of calls nobody chose -- it would halt
    on the cap, safely, and having to explain that to somebody is not a design.
    """

    def test_an_unscoped_run_asks_only_the_free_sources(self) -> None:
        registry = [
            _Source(source="eurostat", charges=False),
            _Source(source="llm_search", charges=True),
        ]

        asked = asked_this_run(registry, attributes_named=False)

        assert [str(source.data_source) for source in asked] == ["eurostat"]

    def test_a_run_that_names_its_attributes_asks_everything(self) -> None:
        registry = [
            _Source(source="eurostat", charges=False),
            _Source(source="llm_search", charges=True),
        ]

        asked = asked_this_run(registry, attributes_named=True)

        assert len(asked) == 2

    def test_a_registry_of_free_sources_is_unaffected_either_way(self) -> None:
        registry = [_Source(source="eurostat", charges=False)]

        assert len(asked_this_run(registry, attributes_named=False)) == 1
        assert len(asked_this_run(registry, attributes_named=True)) == 1


def _catalogued(source: str, *, enabled: bool) -> DataSource:
    """One source as the catalog holds it, with only the switch varying."""
    return DataSource(
        id=DataSourceId(source),
        name=source,
        source_kind=SourceKind.STRUCTURED,
        default_priority=10,
        reliability_tier=ReliabilityTierId("official_international"),
        is_enabled=enabled,
    )


class TestASourceThatIsSwitchedOff:
    """A source the household has switched off is not asked (`reqs.md` 2, Q232).

    The same switch keeps its stored values out of the active-value comparison, so asking it
    again would fetch figures that cannot score -- work nobody wants, and paid for where the
    source charges.
    """

    def test_a_disabled_source_is_not_asked(self) -> None:
        adapters = [
            _Source(source="eurostat", charges=False),
            _Source(source="numbeo", charges=False),
        ]

        asked = switched_on(
            adapters,
            [_catalogued("eurostat", enabled=True), _catalogued("numbeo", enabled=False)],
        )

        assert [str(each.data_source) for each in asked] == ["eurostat"]

    def test_every_source_is_asked_when_none_is_switched_off(self) -> None:
        adapters = [_Source(source="eurostat", charges=False)]

        asked = switched_on(adapters, [_catalogued("eurostat", enabled=True)])

        assert len(asked) == 1

    def test_switching_every_source_off_leaves_nothing_to_ask(self) -> None:
        adapters = [
            _Source(source="eurostat", charges=False),
            _Source(source="numbeo", charges=False),
        ]

        asked = switched_on(
            adapters,
            [_catalogued("eurostat", enabled=False), _catalogued("numbeo", enabled=False)],
        )

        assert asked == ()

    def test_an_adapter_the_catalog_does_not_know_is_kept(self) -> None:
        """A declaration fault the boot check exists to catch.

        Silently skipping it here would hide it behind a run that merely fetched less than it
        should have.
        """
        adapters = [_Source(source="undeclared", charges=False)]

        asked = switched_on(adapters, [_catalogued("eurostat", enabled=True)])

        assert [str(each.data_source) for each in asked] == ["undeclared"]

    def test_the_two_filters_compose(self) -> None:
        """Switched off and charges-without-a-scope are separate reasons not to ask."""
        adapters = [
            _Source(source="eurostat", charges=False),
            _Source(source="llm_search", charges=True),
            _Source(source="numbeo", charges=False),
        ]

        consulted = switched_on(
            adapters,
            [
                _catalogued("eurostat", enabled=True),
                _catalogued("llm_search", enabled=True),
                _catalogued("numbeo", enabled=False),
            ],
        )
        asked = asked_this_run(consulted, attributes_named=False)

        assert [str(each.data_source) for each in asked] == ["eurostat"]
