"""The four interfaces `data` declares, and the promises their shapes make.

There is no behaviour to test in an abstract method. What is tested is that each seam is
genuinely abstract, that it is satisfiable, and that its signature still says what
`arch.md` 6.3 says it says -- a signature being exactly the kind of thing that drifts quietly.

The most important assertion here is the negative one: **neither store offers an update or a
delete.** Values are never overwritten and catalog rows change only by migration, and a store
that offered either would be inviting the one thing the ontology forbids.
"""

import inspect
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from starnest.candidates import Level, LevelHierarchy
from starnest.data import (
    Attribute,
    CatalogStore,
    Clock,
    ConfidenceLevel,
    ExternalScore,
    Monetary,
    Pillar,
    ReferencePeriod,
    UnknownAttributeError,
    Value,
    ValueStore,
    ValueType,
)

FETCHED = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)

A_VALUE = Value(
    candidate="country.portugal",
    attribute="country.rent_centre",
    value_type=ValueType.MONETARY,
    data_source="numbeo",
    reference_period=ReferencePeriod.covering_year(2026),
    retrieval_date=FETCHED,
    confidence_level=ConfidenceLevel.MEDIUM,
    payload=Monetary.in_euro(Decimal("1410")),
)
AN_ATTRIBUTE = Attribute(
    id="country.rent_centre",
    name="Rent, city centre",
    level="country",
    value_type=ValueType.MONETARY,
    pillar="housing",
)


class InMemoryValueStore(ValueStore):
    """The smallest implementation that satisfies the seam, used to prove it is satisfiable."""

    def __init__(self) -> None:
        self._values: list[Value] = []
        self._external_scores: list[ExternalScore] = []

    async def read_active_values(self, *, level=None, candidates=(), attributes=()):
        return tuple(value for value in self._values if not value.is_rejected)

    async def read_values(
        self, *, candidate=None, attribute=None, include_superseded=True, limit=None, offset=0
    ):
        return tuple(self._values)

    async def count_values(self, *, candidate=None, attribute=None, include_superseded=True):
        return len(self._values)

    async def append(self, values):
        stored = tuple(
            value.model_copy(update={"id": len(self._values) + offset + 1})
            for offset, value in enumerate(values)
        )
        self._values.extend(stored)
        return stored

    async def read_external_scores(self, *, candidate=None, level=None):
        return tuple(self._external_scores)

    async def append_external_score(self, score):
        self._external_scores.append(score)
        return score


class InMemoryCatalogStore(CatalogStore):
    async def read_levels(self):
        return LevelHierarchy([Level(id="country", depth_order=1)])

    async def read_pillars(self):
        return (Pillar(id="housing", name="Housing"),)

    async def read_attributes(self, *, level=None, include_retired=False):
        return (AN_ATTRIBUTE,)

    async def read_attribute(self, attribute_id):
        if attribute_id != AN_ATTRIBUTE.id:
            raise UnknownAttributeError(f"no attribute {attribute_id!r}")
        return AN_ATTRIBUTE

    async def read_data_sources(self):
        return ()

    async def read_breakdown_schemes(self):
        return {}

    async def read_match_rules(self, *, level=None):
        return ()

    async def read_compound_rules(self, *, level=None):
        return ()


class FixedClock(Clock):
    def __init__(self, moment: datetime) -> None:
        self._moment = moment

    def now(self) -> datetime:
        return self._moment


@pytest.mark.parametrize("seam", [ValueStore, CatalogStore, Clock])
class TestEverySeamIsAbstract:
    def test_cannot_be_used_without_being_implemented(self, seam: type) -> None:
        with pytest.raises(TypeError):
            seam()  # type: ignore[abstract]

    def test_declares_no_implementation_of_its_own(self, seam: type) -> None:
        """A store with a body is a store that decided something on the domain's behalf."""
        assert seam.__abstractmethods__


class TestNeitherStoreCanChangeWhatIsStored:
    @pytest.mark.parametrize("seam", [ValueStore, CatalogStore])
    @pytest.mark.parametrize("forbidden", ["update", "delete", "replace", "save"])
    def test_offers_no_operation_that_would_overwrite_anything(
        self, seam: type, forbidden: str
    ) -> None:
        assert not [name for name in vars(seam) if forbidden in name]


class TestTheValueStore:
    async def test_appends_and_reads_back_what_it_stored(self) -> None:
        store = InMemoryValueStore()
        (stored,) = await store.append([A_VALUE])
        assert stored.id is not None
        assert await store.read_values() == (stored,)
        assert await store.count_values() == 1

    async def test_a_rejected_value_stays_stored_and_is_not_active(self) -> None:
        store = InMemoryValueStore()
        await store.append([A_VALUE.model_copy(update={"rejection_reason": "not credible"})])
        assert await store.count_values() == 1
        assert await store.read_active_values() == ()

    async def test_external_scores_are_read_through_their_own_operation(self) -> None:
        """Never alongside values, so nothing can sum them by accident."""
        store = InMemoryValueStore()
        score = ExternalScore(
            candidate="country.portugal",
            data_source="numbeo",
            published_scale="0-100",
            published_value=Decimal("74.3"),
            reference_period=ReferencePeriod.covering_year(2026),
            retrieval_date=FETCHED,
        )
        await store.append_external_score(score)
        assert await store.read_external_scores() == (score,)
        assert await store.read_active_values() == ()


class TestTheCatalogStore:
    async def test_returns_the_levels_as_a_validated_hierarchy(self) -> None:
        levels = await InMemoryCatalogStore().read_levels()
        assert levels.top_level.id == "country"

    async def test_an_attribute_that_is_not_in_the_catalog_is_a_lookup_failure(self) -> None:
        with pytest.raises(UnknownAttributeError):
            await InMemoryCatalogStore().read_attribute("country.invented")

    async def test_retired_attributes_are_excluded_unless_asked_for(self) -> None:
        signature = inspect.signature(CatalogStore.read_attributes)
        assert signature.parameters["include_retired"].default is False


class TestTheClock:
    def test_today_is_the_day_now_falls_on(self) -> None:
        """Derived rather than overridable: a clock whose today disagreed with its now would
        be a genuinely confusing thing to debug."""
        clock = FixedClock(datetime(2026, 8, 19, 23, 59, tzinfo=UTC))
        assert clock.today() == date(2026, 8, 19)

    def test_exists_so_staleness_can_be_tested_without_waiting(self) -> None:
        assert (
            AN_ATTRIBUTE.has_gone_stale(
                ReferencePeriod.covering_year(2019), on=FixedClock(FETCHED).today()
            )
            is False
        )
