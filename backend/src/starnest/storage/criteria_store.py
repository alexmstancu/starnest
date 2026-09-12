"""`CriteriaStore` against PostgreSQL: the subjective half of the model.

`arch.md` 6.3. A criteria set is read whole -- criteria, anchors, thresholds, pillar weights and
the rules it enforces -- in one query, because that is the read the ranking path makes and a
slider drag should not cost four round trips (`arch.md` 7.2).

**A set is written whole, in one transaction.** Weights sum to 100 within a pillar and within a
level, so a write that reached some criteria and not others would leave a set the domain would
refuse to construct -- stored, and unreadable ever after. `CriteriaSet` validates those sums on
the way out of the database as much as on the way in, which is what makes this safe rather than
merely careful.

**The thresholds and anchors are children of a criterion whose id is generated**, so replacing a
set means writing the criteria first and hanging the rest off the ids that came back.
"""

from decimal import Decimal
from typing import Any

from psycopg import AsyncConnection
from psycopg.errors import UniqueViolation
from psycopg_pool import AsyncConnectionPool

from starnest.criteria import (
    BooleanThreshold,
    CriteriaSet,
    CriteriaSetExistsError,
    CriteriaSetId,
    CriteriaStore,
    Criterion,
    Goal,
    LabelThreshold,
    MatchingThreshold,
    NormalisationMethod,
    PillarWeight,
    RangeThreshold,
    ReducerMode,
    ScaleAnchor,
    ShareThreshold,
    UnknownCriteriaSetError,
)
from starnest.data import ValueType
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresCriteriaStore(CriteriaStore):
    """Criteria sets, as the tables of `0009-criteria.sql` hold them."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_criteria_set_summaries(self) -> tuple[tuple[CriteriaSetId, str], ...]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_criteria_sets(connection)]
        return tuple((CriteriaSetId(row.id), row.name) for row in rows)

    async def read_criteria_set(
        self, criteria_set: CriteriaSetId | str, *, level: str | None = None
    ) -> CriteriaSet:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_criteria_set(
                connection, criteria_set=str(criteria_set), level=level
            )
        if row is None:
            raise UnknownCriteriaSetError(f"there is no criteria set called {criteria_set!r}")
        return _criteria_set_from(row)

    async def create_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Write a set whole, refusing an identifier something already holds.

        The conflict arrives as a driver error and is translated here: `psycopg` types belong to
        this module, and one that reached `api/` would become a 500 for a request that was
        merely asking for something taken.
        """
        try:
            async with acquire(self._pool) as connection:
                await self._queries.insert_criteria_set(
                    connection, criteria_set=str(criteria_set.id), name=criteria_set.name
                )
                await self._write_contents(connection, criteria_set)
        except UniqueViolation as taken:
            raise CriteriaSetExistsError(
                f"a criteria set called {criteria_set.id!r} already exists"
            ) from taken

    async def replace_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Delete the contents and write them again, inside one transaction.

        Whole rather than differential: working out which criteria changed would mean this
        module knowing what a change to a set means, and that knowledge lives in `criteria/`
        where the rebalancing rules are. A caller reads a set, asks the domain for the new one,
        and hands the result back.
        """
        async with acquire(self._pool) as connection:
            existing = await self._queries.select_criteria_set(
                connection, criteria_set=str(criteria_set.id), level=None
            )
            if existing is None:
                raise UnknownCriteriaSetError(
                    f"there is no criteria set called {criteria_set.id!r} to replace"
                )
            await self._queries.update_criteria_set_name(
                connection, criteria_set=str(criteria_set.id), name=criteria_set.name
            )
            await self._queries.delete_criteria_set_contents(
                connection, criteria_set=str(criteria_set.id)
            )
            await self._write_contents(connection, criteria_set)

    async def delete_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        async with acquire(self._pool) as connection:
            existing = await self._queries.select_criteria_set(
                connection, criteria_set=str(criteria_set), level=None
            )
            if existing is None:
                raise UnknownCriteriaSetError(
                    f"there is no criteria set called {criteria_set!r} to delete"
                )
            await self._queries.delete_criteria_set_contents(
                connection, criteria_set=str(criteria_set)
            )
            await self._queries.delete_criteria_set(connection, criteria_set=str(criteria_set))

    async def _write_contents(self, connection: AsyncConnection, criteria_set: CriteriaSet) -> None:
        """Every criterion with its children, every pillar weight, and the rules the set applies.

        **The rule lists are written here because the replace clears them.** A set is written
        whole, and `delete_criteria_set_contents` empties `criteria_set_match_rule` and
        `criteria_set_compound_rule` along with everything else; until 2026-09-12 nothing wrote
        them back, so editing a single weight silently released every gate the set enforced
        (`known-issues.md` P15).
        """
        for rule in sorted(criteria_set.enforced_match_rules):
            await self._queries.upsert_criteria_set_match_rule(
                connection,
                criteria_set=str(criteria_set.id),
                match_rule=str(rule),
                is_enforced=True,
            )
        for rule in sorted(criteria_set.applied_compound_rules):
            await self._queries.upsert_criteria_set_compound_rule(
                connection,
                criteria_set=str(criteria_set.id),
                compound_rule=str(rule),
                is_applied=True,
            )
        for weight in criteria_set.pillar_weights:
            await self._queries.upsert_pillar_weight(
                connection,
                criteria_set=str(criteria_set.id),
                pillar=str(weight.pillar),
                level=str(weight.level),
                weight=weight.weight,
                weight_locked=weight.weight_locked,
            )
        for criterion in criteria_set.criteria:
            written = await self._queries.insert_criterion(
                connection,
                criteria_set=str(criteria_set.id),
                attribute=str(criterion.attribute),
                value_type=str(criterion.value_type),
                breakdown_option=criterion.breakdown_option,
                is_scored=criterion.is_scored,
                weight=criterion.weight,
                weight_locked=criterion.weight_locked,
                goal=str(criterion.goal),
                target_range_min=criterion.target_range_min,
                target_range_max=criterion.target_range_max,
                zero_score_below=criterion.zero_score_below,
                zero_score_above=criterion.zero_score_above,
                normalisation_method=str(criterion.normalisation_method),
                reducer_mode=str(criterion.reducer_mode) if criterion.reducer_mode else None,
                blocks_if_missing=criterion.blocks_if_missing,
            )
            # aiosql's insert-returning hands back the row, not the column. The id is what the
            # anchors and the threshold hang off, so it is unwrapped once here rather than in
            # each of them.
            criterion_id = written.id
            await self._write_anchors(connection, criterion_id, criterion)
            await self._write_threshold(connection, criterion_id, criterion)

    async def _write_anchors(
        self, connection: AsyncConnection, criterion_id: int, criterion: Criterion
    ) -> None:
        if not criterion.scale_anchors:
            return
        await self._queries.replace_criterion_scale_anchors(
            connection,
            criterion=criterion_id,
            input_values=[anchor.input_value for anchor in criterion.scale_anchors],
            scores=[anchor.score for anchor in criterion.scale_anchors],
            # Nullable, so a short array would silently blank labels rather than fail
            # (known-issues D22). Built from the same list, so it cannot be short.
            labels=[anchor.label for anchor in criterion.scale_anchors],
        )

    async def _write_threshold(
        self, connection: AsyncConnection, criterion_id: int, criterion: Criterion
    ) -> None:
        """Whichever of the four shapes this criterion carries.

        Written here rather than left out, which is what the first draft of this module did:
        a set with a matching threshold would have round-tripped through create-and-read and
        come back without it -- exactly the shape of the band-label defect H5, where a copy
        looked right and read wrong.

        The composite key of `0009` refuses a shape that does not suit the attribute's value
        type, so nothing here re-checks it; `Criterion` has already refused it too, with a
        sentence.
        """
        threshold = criterion.matching_threshold
        if threshold is None:
            return
        if isinstance(threshold, RangeThreshold):
            await self._queries.insert_criterion_threshold_range(
                connection,
                criterion=criterion_id,
                value_type=str(criterion.value_type),
                min_value=threshold.min_value,
                max_value=threshold.max_value,
            )
        elif isinstance(threshold, BooleanThreshold):
            await self._queries.insert_criterion_threshold_boolean(
                connection, criterion=criterion_id, required_value=threshold.required_value
            )
        elif isinstance(threshold, LabelThreshold):
            await self._queries.insert_criterion_threshold_labels(
                connection,
                criterion=criterion_id,
                labels=[threshold.label],
                containment_rules=[threshold.containment_rule],
            )
        elif isinstance(threshold, ShareThreshold):
            await self._queries.insert_criterion_threshold_share(
                connection,
                criterion=criterion_id,
                label=threshold.label,
                min_share=threshold.min_share,
                max_share=threshold.max_share,
            )


def _criteria_set_from(row: Any) -> CriteriaSet:
    """One row of four JSON aggregates as the domain object `criteria/` declared."""
    return CriteriaSet(
        id=row.id,
        name=row.name,
        criteria=tuple(_criterion_from(entry, row.id) for entry in row.criteria),
        pillar_weights=tuple(_pillar_weight_from(entry) for entry in row.pillar_weights),
        enforced_match_rules=tuple(row.enforced_match_rules),
        applied_compound_rules=tuple(row.applied_compound_rules),
    )


def _criterion_from(entry: dict[str, Any], criteria_set: str) -> Criterion:
    """One criterion out of the aggregate.

    The set identifier comes from the row rather than the aggregate: every criterion in that
    JSON belongs to the set being read, so repeating it 41 times inside the aggregate would be
    41 copies of one fact.
    """
    return Criterion(
        criteria_set=criteria_set,
        attribute=entry["attribute"],
        pillar=entry["pillar"],
        value_type=ValueType(entry["value_type"]),
        is_scored=entry["is_scored"],
        weight=Decimal(str(entry["weight"])),
        weight_locked=entry["weight_locked"],
        goal=Goal(entry["goal"]),
        target_range_min=_decimal_or_none(entry["target_range_min"]),
        target_range_max=_decimal_or_none(entry["target_range_max"]),
        zero_score_below=_decimal_or_none(entry["zero_score_below"]),
        zero_score_above=_decimal_or_none(entry["zero_score_above"]),
        normalisation_method=NormalisationMethod(entry["normalisation_method"]),
        breakdown_option=entry["breakdown_option"],
        reducer_mode=ReducerMode(entry["reducer_mode"]) if entry["reducer_mode"] else None,
        blocks_if_missing=entry["blocks_if_missing"],
        scale_anchors=tuple(_anchor_from(anchor) for anchor in entry["scale_anchors"]),
        matching_threshold=_threshold_from(entry),
    )


def _anchor_from(anchor: dict[str, Any]) -> ScaleAnchor:
    return ScaleAnchor(
        input_value=Decimal(str(anchor["input_value"])),
        score=int(anchor["score"]),
        label=anchor["label"],
    )


def _threshold_from(entry: dict[str, Any]) -> MatchingThreshold | None:
    """Whichever of the four shapes this criterion carries, or none.

    Exactly one can be non-empty: the composite keys of `0009` refuse the others, so this reads
    them in order and stops rather than checking that the rest are absent.
    """
    if entry["threshold_range"] is not None:
        span = entry["threshold_range"]
        return RangeThreshold(
            min_value=_decimal_or_none(span["min_value"]),
            max_value=_decimal_or_none(span["max_value"]),
        )
    if entry["threshold_boolean"] is not None:
        return BooleanThreshold(required_value=entry["threshold_boolean"]["required_value"])
    if entry["threshold_labels"]:
        labels = entry["threshold_labels"]
        if len(labels) > 1:
            # The table holds one row per label and `LabelThreshold` holds one label, so a
            # criterion with several is a state the schema permits and the domain cannot
            # represent. Saying so beats returning the first and losing the rest silently.
            raise ValueError(
                f"{entry['attribute']} carries {len(labels)} label thresholds and the domain "
                "models one; the criterion cannot be read until they agree"
            )
        return LabelThreshold(
            label=labels[0]["label"], containment_rule=labels[0]["containment_rule"]
        )
    if entry["threshold_shares"]:
        share = entry["threshold_shares"][0]
        return ShareThreshold(
            label=share["label"],
            min_share=_decimal_or_none(share["min_share"]),
            max_share=_decimal_or_none(share["max_share"]),
        )
    return None


def _pillar_weight_from(entry: dict[str, Any]) -> PillarWeight:
    return PillarWeight(
        pillar=entry["pillar"],
        level=entry["level"],
        weight=Decimal(str(entry["weight"])),
        weight_locked=entry["weight_locked"],
    )


def _decimal_or_none(figure: Any) -> Decimal | None:
    """Money and weights never become floats (`arch.md` 9.6), and JSON gives us floats."""
    return None if figure is None else Decimal(str(figure))
