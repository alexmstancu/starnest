"""`CatalogStore` against PostgreSQL: the objective catalog, read and never written.

`arch.md` 6.3. There is no insert, update or delete anywhere in this file and there must not
be one. The catalog -- levels, pillars, attributes, sources, breakdown schemes -- is data in
the database changed only by migration (`arch.md` 1.2), and an admin screen is deliberately
not part of the product (`reqs.md` 2).

**Nothing here interprets a row.** A pillar's weight, whether an attribute is worth scoring,
which source wins -- none of it is decided in this file. The rows become the domain objects
`data/` declared, and every judgement about them happens in a policy module that cannot import
this one.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Level, LevelHierarchy, LevelId
from starnest.data import (
    AllowedRange,
    Attribute,
    AttributeId,
    BreakdownOptionId,
    BreakdownSchemeId,
    CatalogStore,
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleId,
    CompoundRuleInput,
    CompoundRuleShape,
    DataSource,
    DataSourceId,
    IndexParameters,
    LifecycleStatus,
    MatchRule,
    MatchRuleId,
    Pillar,
    PillarId,
    QuantityParameters,
    RatioParameters,
    RuleOutcome,
    SourceKind,
    SourcePriorityOverride,
    UnitId,
    UnknownAttributeError,
    ValueType,
)
from starnest.data.identifiers import CatalogId, ReliabilityTierId
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresCatalogStore(CatalogStore):
    """The catalog seam, backed by the seeded tables.

    Takes a pool rather than a connection: a store outlives any one transaction, and the
    lifetime of the pool belongs to the composition root (`arch.md` 6.8).
    """

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_levels(self) -> LevelHierarchy:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_levels(connection)]
        return LevelHierarchy(
            Level(
                id=LevelId(row.id),
                depth_order=row.depth_order,
                parent_level=LevelId(row.parent_level) if row.parent_level else None,
            )
            for row in rows
        )

    async def read_pillars(self) -> tuple[Pillar, ...]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_pillars(connection)]
        return tuple(
            Pillar(id=PillarId(row.id), name=row.name, description=row.description) for row in rows
        )

    async def read_attributes(
        self, *, level: str | None = None, include_retired: bool = False
    ) -> tuple[Attribute, ...]:
        rows = await self._select_attributes(level=level, include_retired=include_retired)
        return tuple(_attribute_from(row) for row in rows)

    async def read_attribute(self, attribute_id: AttributeId | str) -> Attribute:
        """One attribute, retired or not.

        A retired attribute is still asked for by name -- every value behind it points at it,
        and the drill-down that displays those values has to say what they measure. Excluding
        it here would make an attribute that still exists look as though it never did.
        """
        rows = await self._select_attributes(attribute_id=str(attribute_id), include_retired=True)
        if not rows:
            raise UnknownAttributeError(f"the catalog has no attribute {str(attribute_id)!r}")
        return _attribute_from(rows[0])

    async def _select_attributes(
        self,
        *,
        level: str | None = None,
        attribute_id: str | None = None,
        include_retired: bool = False,
    ) -> list[Any]:
        """The one attribute query, narrowed by whichever filters the caller supplied.

        `catalog.sql` deliberately serves the list and the single read from the same statement,
        so both get the type parameters, the allowed range, the label vocabulary and the source
        priority overrides in one round trip rather than in five.
        """
        async with acquire(self._pool) as connection:
            return [
                row
                async for row in self._queries.select_attributes(
                    connection,
                    level=level,
                    attribute_id=attribute_id,
                    include_retired=include_retired,
                )
            ]

    async def read_data_sources(self) -> tuple[DataSource, ...]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_data_sources(connection)]
        return tuple(
            DataSource(
                id=DataSourceId(row.id),
                name=row.name,
                source_kind=SourceKind(row.source_kind),
                default_priority=row.default_priority,
                reliability_tier=ReliabilityTierId(row.reliability_tier),
            )
            for row in rows
        )

    async def read_breakdown_schemes(
        self,
    ) -> Mapping[BreakdownSchemeId, tuple[BreakdownOptionId, ...]]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_breakdown_schemes(connection)]
        return {
            BreakdownSchemeId(row.id): tuple(BreakdownOptionId(option) for option in row.options)
            for row in rows
        }

    async def read_match_rules(self, *, level: str | None = None) -> tuple[MatchRule, ...]:
        """The named gates. A rule with no level is asked at every level, so it comes back
        whichever level was requested -- the filter is in the query, where the null lives."""
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_match_rules(connection, level=level)]
        return tuple(
            MatchRule(
                id=MatchRuleId(row.id),
                name=row.name,
                level=LevelId(row.level) if row.level else None,
            )
            for row in rows
        )

    async def read_compound_rules(self, *, level: str | None = None) -> tuple[CompoundRule, ...]:
        """Every rule with whichever children its shape reads, in one round trip.

        Both child lists are aggregated by the query and the one a shape does not read comes
        back empty, so nothing here asks the shape what to fetch next -- and `CompoundRule`
        refuses a rule carrying the wrong kind, which is the same thing the composite key
        refuses on the way in.
        """
        async with acquire(self._pool) as connection:
            rows = [
                row async for row in self._queries.select_compound_rules(connection, level=level)
            ]
        return tuple(_compound_rule_from(row) for row in rows)


def _compound_rule_from(row: Any) -> CompoundRule:
    """One rule row with its two aggregated child lists, as a `CompoundRule`.

    A threshold that is still TBD arrives as `None` and stays `None`. Substituting anything
    for it here would be inventing a bound in the one place nobody would look for one.
    """
    return CompoundRule(
        id=CompoundRuleId(row.id),
        name=row.name,
        level=LevelId(row.level) if row.level else None,
        shape=CompoundRuleShape(row.shape),
        outcome=RuleOutcome(row.outcome),
        threshold_min=row.threshold_min,
        threshold_max=row.threshold_max,
        inputs=_inputs_from(row.inputs),
        conditions=_conditions_from(row.conditions),
    )


def _inputs_from(inputs: Sequence[Mapping[str, Any]]) -> tuple[CompoundRuleInput, ...]:
    return tuple(
        CompoundRuleInput(
            input_order=an_input["input_order"],
            attribute=AttributeId(an_input["attribute"]) if an_input["attribute"] else None,
            household_field=(
                CatalogId(an_input["household_field"]) if an_input["household_field"] else None
            ),
        )
        for an_input in inputs
    )


def _conditions_from(
    conditions: Sequence[Mapping[str, Any]],
) -> tuple[CompoundRuleCondition, ...]:
    return tuple(
        CompoundRuleCondition(
            ordinal=condition["ordinal"],
            attribute=AttributeId(condition["attribute"]),
            threshold_min=condition["threshold_min"],
            threshold_max=condition["threshold_max"],
        )
        for condition in conditions
    )


def _attribute_from(row: Any) -> Attribute:
    """One catalog row, with its five satellite tables already joined on, as an `Attribute`.

    Every optional declaration is present as a column and is `None` when the satellite row does
    not exist, so absence is read from the column rather than from a second query.
    """
    return Attribute(
        id=AttributeId(row.id),
        name=row.name,
        level=LevelId(row.level),
        value_type=ValueType(row.value_type),
        pillar=PillarId(row.pillar) if row.pillar else None,
        description=row.description,
        max_age=row.max_age,
        manual_entry=row.manual_entry,
        lifecycle_status=LifecycleStatus(row.lifecycle_status),
        breakdown_scheme=(
            BreakdownSchemeId(row.breakdown_scheme) if row.breakdown_scheme else None
        ),
        quantity_parameters=(
            QuantityParameters(unit=UnitId(row.quantity_unit)) if row.quantity_unit else None
        ),
        index_parameters=(
            IndexParameters(
                provider=row.index_provider,
                scale_min=row.index_scale_min,
                scale_max=row.index_scale_max,
            )
            if row.index_provider
            else None
        ),
        ratio_parameters=RatioParameters(basis=row.ratio_basis) if row.ratio_basis else None,
        allowed_range=_allowed_range_from(row.allowed_min_value, row.allowed_max_value),
        allowed_labels=tuple(row.allowed_labels),
        source_priority_overrides=_overrides_from(row.source_priority_overrides),
    )


def _allowed_range_from(min_value: Any, max_value: Any) -> AllowedRange | None:
    """A range bounded at neither end is no range at all -- the row simply is not there."""
    if min_value is None and max_value is None:
        return None
    return AllowedRange(min_value=min_value, max_value=max_value)


def _overrides_from(overrides: Sequence[Mapping[str, Any]]) -> tuple[SourcePriorityOverride, ...]:
    return tuple(
        SourcePriorityOverride(
            data_source=DataSourceId(override["data_source"]), rank=override["rank"]
        )
        for override in overrides
    )
