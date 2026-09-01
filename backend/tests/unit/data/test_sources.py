"""Where values come from, and the partial-override rule that orders them.

The worked example in `reqs.md` 6.6 is the test that matters: an override of
`[numbeo, national_statistics]` must yield `numbeo > national_statistics > eurostat > llm >
manual`, because that is what makes connecting a new adapter free of edits to existing
overrides.
"""

import pytest
from pydantic import ValidationError

from starnest.data import (
    DataSource,
    InvalidSourcePriorityError,
    SourceKind,
    SourcePriority,
    SourcePriorityOverride,
    UnknownDataSourceError,
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
