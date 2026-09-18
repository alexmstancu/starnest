"""Levels are ordered records, not a hardcoded pair.

Every test that builds a hierarchy of three is there for one reason: to fail if someone
later writes code that assumes `country` and `city` are the only two rungs (`reqs.md` 3.1).
"""

import pytest
from pydantic import ValidationError

from starnest.candidates import (
    InconsistentHierarchyError,
    Level,
    LevelHierarchy,
    UnknownLevelError,
)

COUNTRY = Level(id="country", depth_order=1)
CITY = Level(id="city", depth_order=2, parent_level="country")
NEIGHBOURHOOD = Level(id="neighbourhood", depth_order=3, parent_level="city")


class TestALevel:
    def test_the_widest_level_is_contained_by_nothing(self) -> None:
        assert COUNTRY.is_top_level
        assert COUNTRY.parent_level is None

    def test_a_nested_level_names_what_contains_it(self) -> None:
        assert not CITY.is_top_level
        assert CITY.parent_level == "country"

    @pytest.mark.parametrize(
        ("parent", "child", "allowed"),
        [
            (COUNTRY, CITY, True),
            (CITY, NEIGHBOURHOOD, True),
            (CITY, CITY, False),
            (COUNTRY, NEIGHBOURHOOD, False),
            (NEIGHBOURHOOD, COUNTRY, False),
        ],
    )
    def test_says_which_level_it_may_contain(
        self, parent: Level, child: Level, allowed: bool
    ) -> None:
        assert parent.may_parent(child) is allowed

    def test_cannot_nest_under_itself(self) -> None:
        with pytest.raises(ValidationError):
            Level(id="city", depth_order=2, parent_level="city")

    @pytest.mark.parametrize("depth_order", [0, -1])
    def test_refuses_an_ordinal_outside_the_scale(self, depth_order: int) -> None:
        with pytest.raises(ValidationError):
            Level(id="city", depth_order=depth_order)

    def test_refuses_a_malformed_identifier(self) -> None:
        with pytest.raises(ValidationError):
            Level(id="City Level", depth_order=1)

    def test_refuses_a_field_it_does_not_declare(self) -> None:
        with pytest.raises(ValidationError):
            Level(id="city", depth_order=2, parent_level="country", name="City")

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            CITY.depth_order = 3


class TestAHierarchy:
    def test_orders_the_rungs_from_the_widest_inwards(self) -> None:
        hierarchy = LevelHierarchy([CITY, COUNTRY])

        assert [level.id for level in hierarchy.ordered] == ["country", "city"]
        assert hierarchy.top_level == COUNTRY

    def test_takes_a_third_level_without_a_line_changing(self) -> None:
        hierarchy = LevelHierarchy([NEIGHBOURHOOD, COUNTRY, CITY])

        assert len(hierarchy) == 3
        assert [level.id for level in hierarchy] == ["country", "city", "neighbourhood"]
        assert hierarchy.children_of(CITY) == (NEIGHBOURHOOD,)
        assert hierarchy.children_of(NEIGHBOURHOOD) == ()

    def test_finds_a_level_by_identifier(self) -> None:
        hierarchy = LevelHierarchy([COUNTRY, CITY])

        assert hierarchy.get("city") == CITY
        assert "city" in hierarchy
        assert "neighbourhood" not in hierarchy

    def test_refuses_to_invent_a_level_it_does_not_have(self) -> None:
        with pytest.raises(UnknownLevelError, match="neighbourhood"):
            LevelHierarchy([COUNTRY, CITY]).get("neighbourhood")

    def test_renders_its_rungs_in_order(self) -> None:
        assert repr(LevelHierarchy([CITY, COUNTRY])) == "LevelHierarchy(['country', 'city'])"


class TestAHierarchyThatWouldNotHold:
    """Levels are seeded by migration, where each of these is easy and silent."""

    def test_needs_at_least_one_level(self) -> None:
        with pytest.raises(InconsistentHierarchyError, match="at least one"):
            LevelHierarchy([])

    def test_refuses_two_levels_with_the_same_identifier(self) -> None:
        twin = Level(id="city", depth_order=9, parent_level="country")

        with pytest.raises(InconsistentHierarchyError, match="identifier"):
            LevelHierarchy([COUNTRY, CITY, twin])

    def test_refuses_two_levels_at_the_same_depth(self) -> None:
        rival = Level(id="province", depth_order=2, parent_level="country")

        with pytest.raises(InconsistentHierarchyError, match="depth_order"):
            LevelHierarchy([COUNTRY, CITY, rival])

    def test_refuses_two_levels_claiming_to_be_the_widest(self) -> None:
        with pytest.raises(InconsistentHierarchyError, match="widest"):
            LevelHierarchy([COUNTRY, Level(id="continent", depth_order=2)])

    def test_refuses_a_parent_that_is_not_in_the_set(self) -> None:
        with pytest.raises(InconsistentHierarchyError, match="not in this hierarchy"):
            LevelHierarchy([COUNTRY, NEIGHBOURHOOD])

    def test_refuses_a_parent_that_is_not_wider_than_its_child(self) -> None:
        inverted = Level(id="city", depth_order=4, parent_level="neighbourhood")
        deeper_parent = Level(id="neighbourhood", depth_order=5, parent_level="country")

        with pytest.raises(InconsistentHierarchyError, match="not wider"):
            LevelHierarchy([COUNTRY, inverted, deeper_parent])

    def test_refuses_a_branching_tree(self) -> None:
        """**A hierarchy is a chain, and it said so without checking** (D14).

        `InconsistentHierarchyError` is documented as "a set of levels does not describe a
        single, ordered containment chain", and `reqs.md` 3.1 describes inserting rungs into
        one -- `county` between country and city, `neighbourhood` below city. A branch is a
        different shape entirely: `country -> {city, province}` passed every check, because
        each rung had a distinct ordinal, one widest level and a parent wider than itself.

        It matters because scoring, comparison and the parent-not-matching flag all walk the
        chain upwards and assume the walk is unambiguous.
        """
        province = Level(id="province", depth_order=3, parent_level="country")

        with pytest.raises(InconsistentHierarchyError, match="branch"):
            LevelHierarchy([COUNTRY, CITY, province])

    def test_a_chain_three_deep_is_accepted(self) -> None:
        """The control: the check refuses a branch, not a third level."""
        hierarchy = LevelHierarchy([COUNTRY, CITY, NEIGHBOURHOOD])

        assert [level.id for level in hierarchy.ordered] == [
            "country",
            "city",
            "neighbourhood",
        ]
