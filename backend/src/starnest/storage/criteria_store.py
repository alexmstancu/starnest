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

import json
from collections.abc import Callable
from decimal import Decimal
from typing import Any

from psycopg import AsyncConnection
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import LevelId
from starnest.criteria import (
    BooleanThreshold,
    CriteriaSet,
    CriteriaSetExistsError,
    CriteriaSetId,
    CriteriaSetInUseError,
    CriteriaSetNameTakenError,
    CriteriaSetSummary,
    CriteriaStore,
    Criterion,
    Goal,
    HeaviestPillar,
    HighestAnchor,
    LabelThreshold,
    MatchingThreshold,
    NoDefaultCriteriaSetError,
    NormalisationMethod,
    PillarWeight,
    RangeThreshold,
    ReducerMode,
    ScaleAnchor,
    ShareThreshold,
    UnknownCriteriaSetError,
    refuse_anchors_above,
)
from starnest.data import AttributeId, PillarId, UnknownAttributeError, ValueType
from starnest.household import Settings
from starnest.storage.connections import acquire
from starnest.storage.household_store import settings_from, write_settings
from starnest.storage.queries import load_queries

NAME_IS_UNIQUE = "criteria_set_name_is_unique"
"""The index refusing a second live set of one name (`0508`), told apart from the primary key."""


class PostgresCriteriaStore(CriteriaStore):
    """Criteria sets, as the tables of `0009-criteria.sql` hold them."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_criteria_set_summaries(self) -> tuple[CriteriaSetSummary, ...]:
        async with acquire(self._pool) as connection:
            rows = [row async for row in self._queries.select_criteria_sets(connection)]
        return tuple(
            CriteriaSetSummary(
                CriteriaSetId(row.id),
                row.name,
                tuple(
                    HeaviestPillar(
                        LevelId(heaviest["level"]),
                        PillarId(heaviest["pillar"]),
                        Decimal(heaviest["weight"]),
                    )
                    for heaviest in row.heaviest_pillars
                ),
            )
            for row in rows
        )

    async def read_criteria_set(
        self, criteria_set: CriteriaSetId | str, *, level: str | None = None
    ) -> CriteriaSet:
        async with acquire(self._pool) as connection:
            row = await self._queries.select_criteria_set(
                connection, criteria_set=str(criteria_set), level=level, include_deleted=False
            )
        if row is None:
            raise UnknownCriteriaSetError(f"there is no criteria set called {criteria_set!r}")
        return _criteria_set_from(row)

    async def create_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Write a set whole, refusing an identifier something already holds, or a live name.

        The conflict arrives as a driver error and is translated here: `psycopg` types belong to
        this module, and one that reached `api/` would become a 500 for a request that was
        merely asking for something taken. Which of the two was taken is the index's name.

        **The score range is shared first**, as an anchor edit shares it, and the new set's
        anchors are checked against it before the transaction commits: the range is held to live
        sets only, so a copy of a set deleted before it was lowered could otherwise bring an
        anchor back above it (PL-006).
        """
        try:
            async with acquire(self._pool) as connection:
                score_scale_max = await self._share_the_score_scale(connection)
                await self._queries.insert_criteria_set(
                    connection, criteria_set=str(criteria_set.id), name=criteria_set.name
                )
                await self._write_contents(connection, criteria_set)
                await self._refuse_anchors_above(
                    connection,
                    criteria_set.id,
                    score_scale_max,
                    f"the criteria set {criteria_set.name!r} cannot be made",
                )
        except UniqueViolation as taken:
            if taken.diag.constraint_name == NAME_IS_UNIQUE:
                raise CriteriaSetNameTakenError(
                    criteria_set.name, "the new criteria set cannot be made"
                ) from taken
            raise CriteriaSetExistsError(
                f"the identifier {str(criteria_set.id)!r} is held by another criteria set, live "
                "or deleted: an identifier is never given to another set"
            ) from taken

    async def replace_criteria_set(self, criteria_set: CriteriaSet) -> None:
        """Delete the contents and write them again, inside one transaction, under the set's lock.

        Whole rather than differential: working out which criteria changed would mean this
        module knowing what a change to a set means, and that knowledge lives in `criteria/`
        where the rebalancing rules are. A caller reads a set, asks the domain for the new one,
        and hands the result back.

        **The live set is locked first, as an edit locks it.** Read without a lock, a replacement
        racing a deletion saw the set live and rewrote every row the deleted set owns -- so its
        restore was no longer exact (P1-27). Locked, it waits, and then finds nothing to replace.
        """
        async with acquire(self._pool) as connection:
            locked = await self._queries.lock_criteria_set(
                connection, criteria_set=str(criteria_set.id)
            )
            if locked is None:
                raise UnknownCriteriaSetError(
                    f"there is no criteria set called {criteria_set.id!r} to replace"
                )
            await self._write_name(connection, criteria_set)
            await self._queries.delete_criteria_set_contents(
                connection, criteria_set=str(criteria_set.id)
            )
            await self._write_contents(connection, criteria_set)

    async def edit_criteria_set(
        self,
        criteria_set: CriteriaSetId | str,
        mutate: Callable[[CriteriaSet], CriteriaSet],
    ) -> CriteriaSet:
        """Read the set, apply `mutate`, and write the result -- all in one transaction, under a
        lock on the set, so two overlapping edits serialise and both land (ST-02).

        The whole read-modify-write happens on the server inside one request: an endpoint reads
        the set, asks the domain for the changed one, and hands it back. Two such requests racing
        each read the same set and each replace it whole, so the later write silently restored
        whatever the earlier had turned off -- a gate toggle lost to an unrelated weight edit.
        Here the lock is taken first, so the second edit waits until the first commits and then
        reads *its* result: the mutation it applies lands on top of the other, not instead of it.

        `mutate` is the caller's own domain logic -- a rebalance, a rename, a gate toggled -- and
        may raise (a weight that cannot move, an attribute the catalog does not hold); the
        transaction then rolls back and the refusal reaches the caller unchanged. The id never
        changes under an edit (it is assigned once, `arch.md` 3.2a), so the lock and the write
        name the same set.
        """
        async with acquire(self._pool) as connection:
            return await self._edit(connection, criteria_set, mutate)

    async def edit_criteria_set_under_the_score_scale(
        self,
        criteria_set: CriteriaSetId | str,
        mutate: Callable[[CriteriaSet, int | None], CriteriaSet],
    ) -> CriteriaSet:
        """The settings row is shared before the set is locked, as `replace_settings_over_the_
        anchors` takes it before reading anchors, so the two never wait on each other in a cycle.
        """
        async with acquire(self._pool) as connection:
            score_scale_max = await self._share_the_score_scale(connection)
            return await self._edit(
                connection, criteria_set, lambda current: mutate(current, score_scale_max)
            )

    async def replace_settings_over_the_anchors(
        self,
        settings: Settings,
        refuse: Callable[[Settings, HighestAnchor | None], None],
    ) -> None:
        async with acquire(self._pool) as connection:
            await self._queries.ensure_settings(connection)
            stored = await self._queries.lock_settings(connection)
            highest = await self._queries.select_highest_anchor(connection)
            refuse(
                settings_from(stored),
                None if highest is None else _highest_anchor_from(highest),
            )
            await write_settings(self._queries, connection, settings)

    async def _share_the_score_scale(self, connection: AsyncConnection) -> int | None:
        await self._queries.ensure_settings(connection)
        return (await self._queries.share_settings(connection)).score_scale_max

    async def _refuse_anchors_above(
        self,
        connection: AsyncConnection,
        criteria_set: CriteriaSetId | str,
        score_scale_max: int | None,
        refused: str,
    ) -> None:
        highest = await self._queries.select_highest_anchor_of_set(
            connection, criteria_set=str(criteria_set)
        )
        refuse_anchors_above(
            refused,
            score_scale_max,
            None if highest is None else _highest_anchor_from(highest),
        )

    async def _edit(
        self,
        connection: AsyncConnection,
        criteria_set: CriteriaSetId | str,
        mutate: Callable[[CriteriaSet], CriteriaSet],
    ) -> CriteriaSet:
        locked = await self._queries.lock_criteria_set(connection, criteria_set=str(criteria_set))
        if locked is None:
            raise UnknownCriteriaSetError(
                f"there is no criteria set called {criteria_set!r} to edit"
            )
        row = await self._queries.select_criteria_set(
            connection, criteria_set=str(criteria_set), level=None, include_deleted=False
        )
        changed = mutate(_criteria_set_from(row))
        await self._write_name(connection, changed)
        await self._queries.delete_criteria_set_contents(connection, criteria_set=str(criteria_set))
        await self._write_contents(connection, changed)
        return changed

    async def discard_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        """One column set, nothing else touched (PL-033); waits for an edit holding the lock."""
        async with acquire(self._pool) as connection:
            discarded = await self._queries.discard_criteria_set(
                connection, criteria_set=str(criteria_set)
            )
        if discarded is None:
            raise UnknownCriteriaSetError(
                f"there is no criteria set called {criteria_set!r} to delete"
            )

    async def restore_criteria_set(self, criteria_set: CriteriaSetId | str) -> CriteriaSet:
        """Clear the one column the deletion set, under the set's lock, and read what came back.

        **Locked before it reads** (review of f6d1f01). Restoring a live set is idempotent, so it
        can meet an edit in flight; read first, it answered with the set as it stood before that
        edit committed. The lock's row carries the name, because a refusal over the name must say
        which name and the driver's message gives it folded to lower case.

        **The score range is shared before the set is locked**, the order an anchor edit takes
        them in, so the two never wait on each other in a cycle; a range lowered while the set
        was deleted is checked against its anchors here (PL-006, PL-033).
        """
        async with acquire(self._pool) as connection:
            score_scale_max = await self._share_the_score_scale(connection)
            held = await self._queries.lock_criteria_set_live_or_deleted(
                connection, criteria_set=str(criteria_set)
            )
            if held is None:
                raise UnknownCriteriaSetError(
                    f"there is no criteria set called {criteria_set!r} to restore"
                )
            await self._refuse_anchors_above(
                connection,
                criteria_set,
                score_scale_max,
                f"the criteria set {held.name!r} cannot be restored",
            )
            try:
                await self._queries.restore_criteria_set(connection, criteria_set=str(criteria_set))
            except UniqueViolation as taken:
                raise CriteriaSetNameTakenError(
                    held.name, "the deleted criteria set cannot be restored"
                ) from taken
            restored = await self._queries.select_criteria_set(
                connection, criteria_set=str(criteria_set), level=None, include_deleted=False
            )
        return _criteria_set_from(restored)

    async def read_default_criteria_set(self) -> CriteriaSet:
        async with acquire(self._pool) as connection:
            default = await self._queries.select_default_criteria_set_id(connection)
            if default is None:
                raise NoDefaultCriteriaSetError(
                    "no criteria set is the default, so a new set has nothing to copy"
                )
            row = await self._queries.select_criteria_set(
                connection, criteria_set=default.id, level=None, include_deleted=True
            )
        return _criteria_set_from(row)

    async def purge_criteria_set(self, criteria_set: CriteriaSetId | str) -> None:
        """Destroy a set, live or deleted, unless a saved evaluation is holding it in place.

        **A `ForeignKeyViolation` here is a refusal, not a fault** (P60). `evaluation.criteria_set`
        references the set with no `ON DELETE`, so this used to hand `api/` a driver exception and
        a request that was merely refused became a 500. Translated for the same reason
        `household_store` translates it: `psycopg` types belong to this module -- and so does
        their text, which the refusal used to carry along to the screen (PL-035). The refusal
        names the set by its name, which the lock reads back (PL-003).

        **Locked first**, so an edit in flight finishes before anything is cleared: unlocked, a
        row it wrote meanwhile outlived the clearing and the purge was refused as "in use".
        """
        async with acquire(self._pool) as connection:
            locked = await self._queries.lock_criteria_set_live_or_deleted(
                connection, criteria_set=str(criteria_set)
            )
            if locked is None:
                raise UnknownCriteriaSetError(
                    f"there is no criteria set called {criteria_set!r} to purge"
                )
            try:
                await self._queries.delete_criteria_set_contents(
                    connection, criteria_set=str(criteria_set)
                )
                await self._queries.delete_criteria_set(connection, criteria_set=str(criteria_set))
            except ForeignKeyViolation as held:
                raise CriteriaSetInUseError(
                    f"the criteria set {locked.name!r} cannot be purged: a saved evaluation was "
                    "computed from it and still names it"
                ) from held

    async def _write_name(self, connection: AsyncConnection, criteria_set: CriteriaSet) -> None:
        """The name, refused when another live set has it: the only unique thing a rename can
        break, so any violation here is that one."""
        try:
            await self._queries.update_criteria_set_name(
                connection, criteria_set=str(criteria_set.id), name=criteria_set.name
            )
        except UniqueViolation as taken:
            raise CriteriaSetNameTakenError(
                criteria_set.name, "the criteria set cannot be renamed"
            ) from taken

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
                outcome=str(criteria_set.outcome_of_gate(rule)),
            )
        for rule in sorted(criteria_set.applied_compound_rules):
            outcome = criteria_set.compound_rule_outcomes.get(rule)
            await self._queries.upsert_criteria_set_compound_rule(
                connection,
                criteria_set=str(criteria_set.id),
                compound_rule=str(rule),
                outcome=None if outcome is None else str(outcome),
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
            # **No row back means the attribute does not exist** (P61). `insert_criterion` is an
            # `INSERT … SELECT … FROM attribute WHERE id = :attribute`, so an attribute the
            # catalog does not hold matches nothing: no constraint fires and aiosql returns
            # `None`. Reading `.id` off that made a well-formed request an `AttributeError` and
            # a 500. The neighbouring case is already loud -- a pillar-less attribute trips a
            # `NOT NULL` (`0106`) -- and this one now says the same kind of thing.
            if written is None:
                raise UnknownAttributeError(
                    f"the criteria set {criteria_set.name!r} names the attribute "
                    f"{str(criterion.attribute)!r}, which the catalog does not hold"
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
        # **One anchor per object, so the three fields cannot come apart** (D22). This passed
        # three parallel arrays, and `unnest` pads the short ones with NULL rather than
        # complaining -- which `score` catches by being `NOT NULL` and `label` does not.
        await self._queries.replace_criterion_scale_anchors(
            connection,
            criterion=criterion_id,
            anchors=json.dumps(
                [
                    {
                        # As text, because a JSON number would take a `numeric` through a float
                        # on the way in and this is a figure somebody chose (`arch.md` 9.6).
                        "input_value": str(anchor.input_value),
                        "score": anchor.score,
                        "label": anchor.label,
                    }
                    for anchor in criterion.scale_anchors
                ]
            ),
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
            await self._queries.insert_criterion_threshold_label(
                connection,
                criterion=criterion_id,
                label=threshold.label,
                containment_rule=threshold.containment_rule,
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
        match_rule_outcomes=row.match_rule_outcomes,
        compound_rule_outcomes=row.compound_rule_outcomes,
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
        label = _the_one(entry, "threshold_labels", "label thresholds")
        return LabelThreshold(label=label["label"], containment_rule=label["containment_rule"])
    if entry["threshold_shares"]:
        share = _the_one(entry, "threshold_shares", "share bounds")
        return ShareThreshold(
            label=share["label"],
            min_share=_decimal_or_none(share["min_share"]),
            max_share=_decimal_or_none(share["max_share"]),
        )
    return None


def _the_one(entry: dict[str, Any], key: str, kind: str) -> dict[str, Any]:
    """The one bound of its kind a criterion carries, refused rather than chosen among.

    `0520` lets each table hold one row per criterion, as the domain models one. A database
    rolled back past it can hold several again, and returning the first would lose the rest
    silently on the next edit -- so the criterion is refused, naming what it carries.
    """
    bounds = entry[key]
    if len(bounds) > 1:
        raise ValueError(
            f"{entry['attribute']} carries {len(bounds)} {kind} and the domain models one; "
            "the criterion cannot be read until they agree"
        )
    return bounds[0]


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


def _highest_anchor_from(row: Any) -> HighestAnchor:
    return HighestAnchor(row.score, CriteriaSetId(row.criteria_set), AttributeId(row.attribute))
