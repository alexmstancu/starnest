"""Where values come from, and the partial-override rule that orders them.

The worked example in `reqs.md` 6.6 is the test that matters: an override of
`[numbeo, national_statistics]` must yield `numbeo > national_statistics > eurostat > llm >
manual`, because that is what makes connecting a new adapter free of edits to existing
overrides.
"""

from collections.abc import Sequence

import pytest
from pydantic import ValidationError

from starnest.data import (
    DataSource,
    InvalidSourceOrderError,
    InvalidSourcePriorityError,
    SourceKind,
    SourcePriority,
    SourcePriorityOverride,
    UnknownDataSourceError,
    reorder_keeping_tiers,
)

EUROSTAT = DataSource(
    id="eurostat",
    name="Eurostat",
    source_kind=SourceKind.STRUCTURED,
    default_priority=10,
    reliability_tier="official_international",
)
NATIONAL_STATISTICS = DataSource(
    id="national_statistics",
    name="National statistics offices",
    source_kind=SourceKind.STRUCTURED,
    default_priority=40,
    reliability_tier="national_authority",
)
NUMBEO = DataSource(
    id="numbeo",
    name="Numbeo",
    source_kind=SourceKind.STRUCTURED,
    default_priority=60,
    reliability_tier="crowdsourced",
)
LLM = DataSource(
    id="llm",
    name="LLM with web search",
    source_kind=SourceKind.LLM,
    default_priority=80,
    reliability_tier="llm",
)
MANUAL = DataSource(
    id="manual",
    name="Manual entry",
    source_kind=SourceKind.MANUAL,
    default_priority=90,
    reliability_tier="manual",
)
CATALOG = (EUROSTAT, NATIONAL_STATISTICS, NUMBEO, LLM, MANUAL)


class TestTheGlobalOrder:
    def test_orders_sources_by_their_default_priority(self) -> None:
        assert SourcePriority.global_order(CATALOG).ordered == (
            "eurostat",
            "national_statistics",
            "numbeo",
            "llm",
            "manual",
        )

    def test_manual_entry_ranks_last(self) -> None:
        """A typed value is a placeholder for a source that does not exist yet."""
        assert SourcePriority.global_order(CATALOG).ordered[-1] == "manual"

    def test_a_source_nobody_declared_cannot_be_ranked(self) -> None:
        with pytest.raises(UnknownDataSourceError):
            SourcePriority.global_order(CATALOG).rank_of("wherenext")

    def test_refuses_a_catalog_with_no_sources_in_it(self) -> None:
        with pytest.raises(InvalidSourcePriorityError):
            SourcePriority.global_order(())

    def test_refuses_the_same_source_twice(self) -> None:
        with pytest.raises(InvalidSourcePriorityError):
            SourcePriority.global_order((EUROSTAT, EUROSTAT))


class TestAnOverrideIsPartial:
    def test_promotes_what_it_names_and_leaves_everything_else_beneath(self) -> None:
        """The worked example of `reqs.md` 6.6, exactly."""
        priority = SourcePriority(
            sources=CATALOG,
            overrides=(
                SourcePriorityOverride(data_source="numbeo", rank=1),
                SourcePriorityOverride(data_source="national_statistics", rank=2),
            ),
        )
        assert priority.ordered == (
            "numbeo",
            "national_statistics",
            "eurostat",
            "llm",
            "manual",
        )

    def test_a_promoted_source_sorts_ahead_of_every_unpromoted_one(self) -> None:
        priority = SourcePriority(
            sources=CATALOG, overrides=(SourcePriorityOverride(data_source="manual", rank=1),)
        )
        assert priority.rank_of("manual") < priority.rank_of("eurostat")

    def test_refuses_an_override_naming_a_source_that_does_not_exist(self) -> None:
        with pytest.raises(UnknownDataSourceError):
            SourcePriority(
                sources=CATALOG,
                overrides=(SourcePriorityOverride(data_source="wherenext", rank=1),),
            )

    def test_refuses_two_sources_promoted_to_the_same_rank(self) -> None:
        """The schema says `UNIQUE (attribute, rank)`; so does this."""
        with pytest.raises(InvalidSourcePriorityError):
            SourcePriority(
                sources=CATALOG,
                overrides=(
                    SourcePriorityOverride(data_source="numbeo", rank=1),
                    SourcePriorityOverride(data_source="eurostat", rank=1),
                ),
            )

    def test_refuses_the_same_source_promoted_twice(self) -> None:
        with pytest.raises(InvalidSourcePriorityError):
            SourcePriority(
                sources=CATALOG,
                overrides=(
                    SourcePriorityOverride(data_source="numbeo", rank=1),
                    SourcePriorityOverride(data_source="numbeo", rank=2),
                ),
            )

    def test_a_rank_starts_at_one(self) -> None:
        with pytest.raises(ValidationError):
            SourcePriorityOverride(data_source="numbeo", rank=0)

    def test_reads_as_the_order_it_is(self) -> None:
        assert "eurostat" in repr(SourcePriority.global_order(CATALOG))


class TestWhatASourceKnowsAboutItself:
    def test_a_manual_source_says_so(self) -> None:
        assert MANUAL.is_typed_by_hand
        assert not EUROSTAT.is_typed_by_hand

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            EUROSTAT.default_priority = 1

    def test_refuses_a_kind_the_schema_does_not_admit(self) -> None:
        with pytest.raises(ValidationError):
            DataSource(
                id="wherenext",
                name="WhereNext",
                source_kind="scraped",
                default_priority=65,
                reliability_tier="crowdsourced",
            )


def _source(identifier: str, priority: int) -> DataSource:
    return DataSource(
        id=identifier,
        name=identifier,
        source_kind=SourceKind.STRUCTURED,
        default_priority=priority,
        reliability_tier="official_international",
    )


def _read_back(sources: Sequence[DataSource], priorities: dict[str, int]) -> list[str]:
    """The order `select_data_sources` would list them in: priority, then id (P76)."""
    return sorted((source.id for source in sources), key=lambda name: (priorities[name], name))


class TestReorderingKeepsTheTiers:
    """D36: one reorder, which hands the stored priorities back out in the new order (PL-136)."""

    TIERED = (_source("a", 10), _source("b", 20), _source("c", 20), _source("d", 50))

    def test_the_current_order_changes_nothing(self) -> None:
        assert reorder_keeping_tiers(self.TIERED, ["a", "b", "c", "d"]) == {
            "a": 10,
            "b": 20,
            "c": 20,
            "d": 50,
        }

    def test_a_move_keeps_every_gap_between_tiers(self) -> None:
        """Never renumbered 1 to n: the numbers stay 10, 20, 20, 50; only who holds them moves."""
        moved = reorder_keeping_tiers(self.TIERED, ["d", "a", "b", "c"])

        assert moved == {"d": 10, "a": 20, "b": 20, "c": 50}
        assert sorted(moved.values()) == [10, 20, 20, 50]

    def test_two_tied_sources_can_be_swapped(self) -> None:
        """A tie reads back by id, so a swap that kept the tie would read back unswapped."""
        swapped = reorder_keeping_tiers(self.TIERED, ["a", "c", "b", "d"])

        assert swapped["c"] < swapped["b"]
        assert _read_back(self.TIERED, swapped) == ["a", "c", "b", "d"]
        assert (swapped["a"], swapped["d"]) == (10, 50)

    def test_a_swap_bumps_into_the_next_tier_without_crossing_it(self) -> None:
        sources = [_source("a", 5), _source("b", 5), _source("c", 6)]

        swapped = reorder_keeping_tiers(sources, ["b", "a", "c"])

        assert _read_back(sources, swapped) == ["b", "a", "c"]

    @pytest.mark.parametrize(
        "order",
        [["d", "c", "b", "a"], ["b", "d", "a", "c"], ["c", "a", "d", "b"], ["a", "c", "b", "d"]],
    )
    def test_every_order_reads_back_as_asked(self, order: list[str]) -> None:
        assert _read_back(self.TIERED, reorder_keeping_tiers(self.TIERED, order)) == order


class TestAnOrderThatIsNotOneOfEverySource:
    SOURCES = (_source("a", 1), _source("b", 2), _source("c", 3))

    def _refusal(self, order: list[str]) -> InvalidSourceOrderError:
        with pytest.raises(InvalidSourceOrderError) as refused:
            reorder_keeping_tiers(self.SOURCES, order)
        return refused.value

    def test_one_that_omits_a_source_is_refused(self) -> None:
        assert self._refusal(["a", "c"]).details == {
            "missing": ["b"],
            "repeated": [],
            "unknown": [],
        }

    def test_one_that_repeats_a_source_is_refused(self) -> None:
        assert self._refusal(["a", "b", "c", "a"]).details == {
            "missing": [],
            "repeated": ["a"],
            "unknown": [],
        }

    def test_one_that_names_an_unknown_source_is_refused(self) -> None:
        assert self._refusal(["a", "b", "c", "nobody"]).details == {
            "missing": [],
            "repeated": [],
            "unknown": ["nobody"],
        }

    def test_an_empty_order_omits_every_source(self) -> None:
        assert self._refusal([]).details["missing"] == ["a", "b", "c"]
