"""`CatalogStore` against the real seeded catalog.

The catalog is data in the database (`arch.md` 1.2), so these tests read what the migrations
actually seeded rather than what a fixture invented. They assert the *shape* a row becomes --
that an index attribute comes back carrying its scale, that an override comes back as an
override -- and never the particular 41 attributes, which are a data change away from being 42.

**Two of them name particular rows anyway, and say so where they do.** A shape assertion over a
mapped list is satisfied by the empty list: sorted, no duplicates, all-true over nothing. So
where the contents are what decide a number -- which source's figure is active, which
attributes a rule reads -- the contents are asserted, and a seed change that invalidates the
test is expected to fail it loudly rather than quietly stop proving anything.
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

# `country.average_working_hours` overrides the global source order and *reverses* it: OECD is
# ranked above Eurostat here, and below it everywhere else. Named rather than described because
# the reversal is the whole point -- a mapper that dropped the override would read Eurostat's
# figure while the `active_value` view read OECD's, and the two would disagree about which
# number is being scored with nothing looking broken.
THE_ORDER_THIS_OVERRIDE_IMPOSES = ("oecd", "eurostat")

A_RULE_THAT_READS_TWO_ATTRIBUTES = "cheap_but_taxed"
THE_ATTRIBUTES_IT_READS = ("country.cost_of_living_index", "country.total_tax_rate_effective")
"""`0446` moved the second from the retired income-tax attribute to the total rate (Q205)."""


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
    """An override is partial (`reqs.md` 6.6), so its ranks are the promoted order only.

    **The sources are named, not merely counted.** Every shape assertion available here is
    satisfied by an empty tuple -- it is sorted, it has no duplicates -- so a mapper that
    returned nothing would look correct. What the override decides is which source's figure is
    active, and only the identifiers say that.
    """
    attribute = await catalog.read_attribute(A_QUANTITY_ATTRIBUTE)

    overrides = attribute.source_priority_overrides
    assert overrides, "this attribute carries an override, and reading none is the bug"
    assert tuple(str(override.data_source) for override in overrides) == (
        THE_ORDER_THIS_OVERRIDE_IMPOSES
    )
    ranks = [override.rank for override in overrides]
    assert ranks == sorted(ranks)
    assert len(set(ranks)) == len(ranks)


async def test_an_override_that_reverses_the_global_order_survives_the_read(
    catalog: PostgresCatalogStore,
) -> None:
    """The case worth pinning: the override and the global order disagree, and it wins.

    An override that merely restated the global order would be indistinguishable from having
    no override at all, so a dropped one would score the same figure by another route. This one
    promotes the source the global order ranks *lower*, which is what makes losing it a wrong
    number rather than a redundant one.
    """
    attribute = await catalog.read_attribute(A_QUANTITY_ATTRIBUTE)
    globally = {source.id: source.default_priority for source in await catalog.read_data_sources()}

    promoted, demoted = THE_ORDER_THIS_OVERRIDE_IMPOSES
    ranked = {
        str(override.data_source): override.rank for override in attribute.source_priority_overrides
    }

    assert ranked[promoted] < ranked[demoted], "the override ranks the promoted source first"
    assert globally[promoted] > globally[demoted], (
        "the seed no longer reverses anything, so this test proves nothing -- pick another"
    )


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
        # Non-emptiness first: a rule whose conditions vanished is a rule that reads nothing
        # and can therefore never fire, and every assertion below it holds vacuously over an
        # empty list.
        assert rule.conditions, f"{rule.id} reads attributes, and reading none is the bug"
        assert [condition.ordinal for condition in rule.conditions] == sorted(
            condition.ordinal for condition in rule.conditions
        )
        assert all(condition.attribute for condition in rule.conditions)


async def test_a_rule_comes_back_reading_the_attributes_it_was_seeded_to_read(
    catalog: PostgresCatalogStore,
) -> None:
    """Which attributes a rule reads is the rule. Naming them is the only way to assert it.

    "Cheap but taxed" is a warning about a country that looks affordable until the tax rate is
    read beside the cost of living, so it is exactly those two attributes in that order -- one
    of them missing turns the warning into something else entirely.
    """
    rules = await catalog.read_compound_rules(level="country")

    rule = next(rule for rule in rules if rule.id == A_RULE_THAT_READS_TWO_ATTRIBUTES)

    assert tuple(str(condition.attribute) for condition in rule.conditions) == (
        THE_ATTRIBUTES_IT_READS
    )
    assert [condition.ordinal for condition in rule.conditions] == [1, 2]


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


async def test_every_country_is_measured_at_its_five_largest_places(
    catalog: PostgresCatalogStore,
) -> None:
    """D4, Q210: 160 places from GeoNames, five per country, heaviest first."""
    centres = await catalog.read_population_centres()

    by_country: dict[str, list] = {}
    for centre in centres:
        by_country.setdefault(str(centre.candidate), []).append(centre)
    assert len(by_country) == 32
    assert {len(places) for places in by_country.values()} == {5}
    romania = [centre.name for centre in by_country["country.romania"]]
    assert romania[0] == "Bucharest"
    assert [c.population for c in by_country["country.romania"]] == sorted(
        (c.population for c in by_country["country.romania"]), reverse=True
    )
