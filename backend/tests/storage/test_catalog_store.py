"""`CatalogStore` against the real seeded catalog.

The catalog is data in the database (`arch.md` 1.2), so these tests read what the migrations
actually seeded rather than what a fixture invented. They assert the *shape* a row becomes --
that an index attribute comes back carrying its scale, that an override comes back as an
override -- and never the particular 41 attributes, which are a data change away from being 42.
"""

from collections.abc import Callable
from typing import Any

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import (
    CompoundRuleShape,
    LifecycleStatus,
    RuleOutcome,
    UnknownAttributeError,
    ValueType,
)
from starnest.storage import PostgresCatalogStore

pytestmark = pytest.mark.storage

A_QUANTITY_ATTRIBUTE = "country.average_working_hours"
AN_INDEX_ATTRIBUTE = "country.english_proficiency"
A_RANGE_BOUNDED_ATTRIBUTE = "country.avg_annual_temperature"
A_LEVEL_WITH_NO_ATTRIBUTES_YET = "city"
A_GATE_ASKED_AT_EVERY_LEVEL = "not_manually_excluded"


@pytest.fixture
def catalog(pool: AsyncConnectionPool) -> PostgresCatalogStore:
    return PostgresCatalogStore(pool)


async def test_levels_come_back_as_one_ordered_containment_chain(
    catalog: PostgresCatalogStore,
) -> None:
    """A hierarchy rather than a list, so nothing has to re-derive which level is widest."""
    levels = await catalog.read_levels()

    assert levels.top_level.is_top_level
    assert [level.depth_order for level in levels] == sorted(level.depth_order for level in levels)
    assert all(level.parent_level in levels for level in levels if level.parent_level is not None)


async def test_every_pillar_has_a_name(catalog: PostgresCatalogStore) -> None:
    pillars = await catalog.read_pillars()

    assert pillars
    assert all(pillar.name for pillar in pillars)
    assert len({pillar.id for pillar in pillars}) == len(pillars)


async def test_an_attribute_carries_the_declarations_of_its_own_type(
    catalog: PostgresCatalogStore,
) -> None:
    """The type parameters are joined on as columns, so one read answers the whole row."""
    quantity = await catalog.read_attribute(A_QUANTITY_ATTRIBUTE)
    index = await catalog.read_attribute(AN_INDEX_ATTRIBUTE)

    assert quantity.value_type is ValueType.QUANTITY
    assert quantity.quantity_parameters is not None
    assert quantity.index_parameters is None

    assert index.value_type is ValueType.INDEX
    assert index.index_parameters is not None
    assert index.index_parameters.scale_min < index.index_parameters.scale_max


async def test_an_allowed_range_survives_as_a_range_and_absence_survives_as_none(
    catalog: PostgresCatalogStore,
) -> None:
    """A range bounded at neither end is no range at all, not a range of two nulls."""
    bounded = await catalog.read_attribute(A_RANGE_BOUNDED_ATTRIBUTE)
    unbounded = await catalog.read_attribute(A_QUANTITY_ATTRIBUTE)

    assert bounded.allowed_range is not None
    assert bounded.allowed_range.excludes(bounded.allowed_range.max_value + 1)
    assert unbounded.allowed_range is None


async def test_source_priority_overrides_come_back_ranked(catalog: PostgresCatalogStore) -> None:
    """An override is partial (`reqs.md` 6.6), so its ranks are the promoted order only."""
    attribute = await catalog.read_attribute(A_QUANTITY_ATTRIBUTE)

    ranks = [override.rank for override in attribute.source_priority_overrides]
    assert ranks == sorted(ranks)
    assert len(set(ranks)) == len(ranks)


async def test_data_sources_come_back_in_the_global_priority_order(
    catalog: PostgresCatalogStore,
) -> None:
    """Lower is higher priority, and reading the list top to bottom is reading that order."""
    sources = await catalog.read_data_sources()

    priorities = [source.default_priority for source in sources]
    assert priorities == sorted(priorities)


async def test_reading_an_attribute_the_catalog_does_not_have_is_a_lookup_error(
    catalog: PostgresCatalogStore,
) -> None:
    with pytest.raises(UnknownAttributeError):
        await catalog.read_attribute("country.nothing_measures_this")


async def test_a_level_with_nothing_seeded_yet_reads_as_empty_not_as_an_error(
    catalog: PostgresCatalogStore,
) -> None:
    """The MVP is the country level (`reqs.md` 1.3); the city catalog is genuinely empty."""
    assert await catalog.read_attributes(level=A_LEVEL_WITH_NO_ATTRIBUTES_YET) == ()


async def test_a_retired_attribute_is_excluded_by_default_and_returned_when_asked_for(
    catalog: PostgresCatalogStore, add_attribute: Callable[..., Any]
) -> None:
    """Retirement drops an attribute out of scoring while its values keep standing."""
    retired = await add_attribute(
        "country.withdrawn_measurement", "Count", lifecycle_status="retired"
    )

    default = await catalog.read_attributes(level="country")
    including_retired = await catalog.read_attributes(level="country", include_retired=True)

    assert retired not in {attribute.id for attribute in default}
    assert retired in {attribute.id for attribute in including_retired}


async def test_one_retired_attribute_is_still_readable_by_name(
    catalog: PostgresCatalogStore, add_attribute: Callable[..., Any]
) -> None:
    """Every value behind it points at it, and the drill-down has to say what they measure."""
    retired = await add_attribute(
        "country.withdrawn_measurement", "Count", lifecycle_status="retired"
    )

    assert (await catalog.read_attribute(retired)).lifecycle_status is LifecycleStatus.RETIRED


async def test_a_descriptive_attribute_has_no_pillar_and_is_never_scored(
    catalog: PostgresCatalogStore, add_attribute: Callable[..., Any]
) -> None:
    """`pillar` is nullable, and null is the whole difference (`reqs.md` 3.3)."""
    descriptive = await add_attribute("country.population_headcount", "Count", pillar=None)

    attribute = await catalog.read_attribute(descriptive)

    assert attribute.pillar is None
    assert not attribute.is_scored


async def test_breakdown_schemes_map_each_scheme_to_its_options(
    catalog: PostgresCatalogStore,
) -> None:
    """None are seeded at the country level, and an empty mapping says exactly that."""
    schemes = await catalog.read_breakdown_schemes()

    assert all(options for options in schemes.values())


async def test_the_gates_come_back_with_the_level_each_is_asked_at(
    catalog: PostgresCatalogStore,
) -> None:
    """Which gates exist is a fact; whether one is enforced is a preference held elsewhere."""
    rules = await catalog.read_match_rules()

    assert rules
    assert all(rule.name for rule in rules)
    assert {rule.id for rule in rules} >= {A_GATE_ASKED_AT_EVERY_LEVEL}


async def test_a_gate_with_no_level_is_returned_whichever_level_is_asked_for(
    catalog: PostgresCatalogStore,
) -> None:
    """A candidate excluded by hand is excluded whether it is a country or a city."""
    at_country = await catalog.read_match_rules(level="country")
    at_city = await catalog.read_match_rules(level=A_LEVEL_WITH_NO_ATTRIBUTES_YET)

    everywhere = next(rule for rule in at_country if rule.id == A_GATE_ASKED_AT_EVERY_LEVEL)
    assert everywhere.level is None
    assert everywhere.applies_at(A_LEVEL_WITH_NO_ATTRIBUTES_YET)
    assert {rule.id for rule in at_city} == {A_GATE_ASKED_AT_EVERY_LEVEL}
    assert all(rule.applies_at("country") for rule in at_country)


async def test_a_compound_rule_comes_back_carrying_the_children_its_shape_reads(
    catalog: PostgresCatalogStore,
) -> None:
    """`AllConditionsHold` reads conditions; the input list it never uses comes back empty."""
    rules = await catalog.read_compound_rules(level="country")

    assert rules
    for rule in rules:
        assert rule.shape is CompoundRuleShape.ALL_CONDITIONS_HOLD
        assert rule.outcome is RuleOutcome.WARNING
        assert rule.inputs == ()
        assert [condition.ordinal for condition in rule.conditions] == sorted(
            condition.ordinal for condition in rule.conditions
        )
        assert all(condition.attribute for condition in rule.conditions)


async def test_the_shipped_rules_come_back_undecided_rather_than_defaulted(
    catalog: PostgresCatalogStore,
) -> None:
    """Every threshold in `reqs.md` 7.4 is TBD, so a null bound must survive the read as one.

    A default invented here would be a rule firing on a number nobody chose, which is the
    fabricated judgement the application exists to prevent (`devplan.md` 0.3 rule 2).
    """
    rules = await catalog.read_compound_rules(level="country")

    assert not any(rule.is_decided for rule in rules)
    assert all(
        condition.threshold_min is None and condition.threshold_max is None
        for rule in rules
        for condition in rule.conditions
    )


async def test_a_level_with_no_compound_rules_reads_as_empty_not_as_an_error(
    catalog: PostgresCatalogStore,
) -> None:
    """The MVP is the country level (`reqs.md` 1.3); the city rules genuinely do not exist."""
    assert await catalog.read_compound_rules(level=A_LEVEL_WITH_NO_ATTRIBUTES_YET) == ()
