-- Freeze three more parts of a criterion in the evaluation snapshot (ST-07, ST-08).
--
-- depends: 0499-rebalance-career-where-the-posting-delete-unbalanced-it
--
-- A saved evaluation exists so that reading it back shows the rule as it WAS, not as it is now
-- (`reqs.md` 5.6). Three parts of that rule were not frozen:
--
--   * `value_type` was read live from `attribute`, on the stated assumption that a type never
--     changes. But `0478` and `0492` retyped attributes in place (`school_system_quality`,
--     `child_benefit_policy`), so a ranking saved before either now reports its frozen criterion
--     under today's type. Frozen here, the snapshot keeps the type it was actually scored under.
--   * `weight_locked` and the typed `matching_threshold` were dropped on read entirely, so a
--     reconstructed criterion lost whether its weight was pinned and the gate it judged by.
--
-- Deliberately NOT a composite foreign key to `attribute (id, value_type)`: that live coupling
-- is exactly what drifts, so the frozen type is a plain column pinned only to the stable
-- `value_type` reference table.

ALTER TABLE evaluation_criterion ADD COLUMN value_type text;

-- Backfill from the live attribute: the only type on record for a row saved before this, and
-- correct for every row where no retyping has intervened. Rows saved after this carry their own.
UPDATE evaluation_criterion AS ec
SET    value_type = a.value_type
FROM   attribute AS a
WHERE  a.id = ec.attribute;

ALTER TABLE evaluation_criterion ALTER COLUMN value_type SET NOT NULL;
ALTER TABLE evaluation_criterion
    ADD CONSTRAINT evaluation_criterion_value_type_is_known
        FOREIGN KEY (value_type) REFERENCES value_type (id);

ALTER TABLE evaluation_criterion ADD COLUMN weight_locked boolean NOT NULL DEFAULT false;
ALTER TABLE evaluation_criterion ALTER COLUMN weight_locked DROP DEFAULT;

-- The threshold the criterion judged by, as one frozen object rather than mirroring the four
-- live child tables: a saved ranking never re-evaluates it -- the match OUTCOME is already
-- frozen in `non_match_reason` -- so it is kept for the record, inspectable but not joined.
ALTER TABLE evaluation_criterion ADD COLUMN matching_threshold jsonb;
