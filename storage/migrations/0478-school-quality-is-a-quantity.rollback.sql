-- Back to an Index with no bounds, which can hold no value at all.
--
-- **This rollback refuses once figures have been stored, and that is the point.** The state it
-- restores is one the forward migration describes exactly: `Index` with no bounds, which "can
-- hold no value at all". So it is not merely awkward to roll back over 31 stored PISA figures
-- -- it is contradictory. `value_matches_attribute_type` is a composite foreign key on
-- `(attribute, value_type)`, so the database says so itself.
--
-- Forcing it would mean deleting those 31 values, and **744 rows of 24 saved evaluations point
-- at them** through `candidate_attribute_score.used_value`. A saved evaluation is a frozen
-- record whose whole promise is that it still explains its score later (`0107`). A rollback
-- that quietly emptied two dozen of them would break a stronger guarantee than the one it was
-- restoring.
--
-- So: a clear refusal naming the remedy, rather than a `ForeignKeyViolation` two statements in.
-- `make migrate` takes a backup before it runs, and `arch.md` 7.4 makes migration explicit for
-- this reason.
--
-- **What it used to do**, for the record: it set `criterion.value_type = 'Index'` while the
-- attribute was still `Quantity`, which the forward migration's own header says is impossible
-- -- neither side of a non-deferrable composite FK can change first. It failed with
-- `Key (attribute, value_type)=(country.school_system_quality, Index) is not present`, and
-- because `yoyo rollback` includes dependents it was a **wall**: with this in the set, none of
-- the 78 migrations before it could be rolled back either. `test_migration_hygiene` checked
-- that a rollback file exists and names the tables the forward one writes; this always did.
-- Only running it finds this.
DO $$
DECLARE
    stored integer;
    frozen integer;
BEGIN
    SELECT count(*) INTO stored FROM value WHERE attribute = 'country.school_system_quality';
    SELECT count(*) INTO frozen
    FROM   candidate_attribute_score s
    JOIN   value v ON v.id = s.used_value
    WHERE  v.attribute = 'country.school_system_quality';

    IF stored > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0478: % figures are stored for country.school_system_quality, '
            'and the Index type this restores declares no bounds, so it can hold none of them. '
            '% saved-evaluation rows also read them. Restore from the backup make migrate took '
            'instead of forcing this.', stored, frozen;
    END IF;
END $$;

-- Below here only runs on a database that has acquired nothing -- which is every fresh one,
-- including the test database, so the path is still exercised.
--
-- **The criteria are lifted out and put back, exactly as the forward migration does it**, for
-- the reason its header gives: `criterion_matches_attribute_type` is a composite foreign key on
-- `(attribute, value_type)` and is not deferrable, so neither side can change first.
CREATE TEMP TABLE lifted AS
SELECT criteria_set, attribute, pillar, is_scored, weight, weight_locked, goal,
       target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   criterion WHERE attribute = 'country.school_system_quality';

DELETE FROM criterion WHERE attribute = 'country.school_system_quality';

-- Before the attribute moves: this row is keyed on `(attribute, value_type)` too, so it cannot
-- be left naming a type the attribute has left behind.
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.school_system_quality';

UPDATE attribute SET value_type = 'Index', description = 'OECD PISA mean score'
WHERE  id = 'country.school_system_quality';

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, target_range_min,
                       target_range_max, zero_score_below, zero_score_above, blocks_if_missing,
                       breakdown_option, reducer_mode)
SELECT criteria_set, attribute, pillar, 'Index', is_scored, weight, weight_locked, goal,
       'as_is', target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   lifted;

DROP TABLE lifted;

-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references.
DELETE FROM unit
WHERE  id = 'pisa_points'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'pisa_points');
