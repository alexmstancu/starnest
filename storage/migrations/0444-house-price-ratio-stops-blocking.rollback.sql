-- **Locked first** (BE-A1): a set edit committed between the copy below and its delete was
-- replaced by the older copy, and a figure stored between the count and the retype met a raw
-- foreign-key error rather than the refusal. SHARE ROW EXCLUSIVE waits for a write in flight
-- and holds off new ones until this commits, while reads go on.
LOCK TABLE value, criterion, criterion_scale_anchor, criterion_threshold_range
    IN SHARE ROW EXCLUSIVE MODE;

-- **Refuses once figures are stored** (P95), for the reason `0478`'s rollback does: a figure
-- is stored under `(attribute, value_type)`, and the Ratio type this restores cannot hold years
-- of income. Forcing it means deleting figures; restoring the backup does not.
DO $$
DECLARE
    stored integer;
BEGIN
    SELECT count(*) INTO stored
    FROM   value WHERE attribute = 'country.house_price_to_income_ratio';
    IF stored > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0444: % figures are stored for country.house_price_to_income_ratio '
            'as years of income, and the Ratio type this restores cannot hold them. Restore from '
            'the backup make migrate took instead of forcing this.', stored;
    END IF;
END $$;

CREATE TEMPORARY TABLE held_criterion ON COMMIT DROP AS
SELECT * FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';

-- **The anchors and the matching threshold come across too** (D69), as every other rule does
-- (RE-3): they hang off the criterion's id, which the delete below ends, so they are held by
-- set and put back on the criterion that replaces it. Left behind, they stopped the delete on
-- their foreign keys; deleted, they would be a person's rules lost.
CREATE TEMPORARY TABLE held_anchor ON COMMIT DROP AS
SELECT judged.criteria_set, anchor.input_value, anchor.score, anchor.label
FROM   criterion_scale_anchor AS anchor
JOIN   criterion AS judged ON judged.id = anchor.criterion
WHERE  judged.attribute = 'country.house_price_to_income_ratio';

CREATE TEMPORARY TABLE held_threshold ON COMMIT DROP AS
SELECT judged.criteria_set, threshold.min_value, threshold.max_value
FROM   criterion_threshold_range AS threshold
JOIN   criterion AS judged ON judged.id = threshold.criterion
WHERE  judged.attribute = 'country.house_price_to_income_ratio';

DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.house_price_to_income_ratio');
DELETE FROM criterion_threshold_range
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.house_price_to_income_ratio');

DELETE FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.house_price_to_income_ratio';

UPDATE attribute SET value_type = 'Ratio', description = 'price ÷ annual income'
WHERE id = 'country.house_price_to_income_ratio';

INSERT INTO attribute_ratio_parameter (attribute, value_type, basis)
VALUES ('country.house_price_to_income_ratio', 'Ratio', 'annual_income');

-- Every rule a person put on the criterion comes back with it (RE-3), and it blocks again.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, breakdown_option, is_scored, weight,
    weight_locked, goal, target_range_min, target_range_max, zero_score_below,
    zero_score_above, normalisation_method, reducer_mode, blocks_if_missing)
SELECT criteria_set, attribute, pillar, 'Ratio', breakdown_option, is_scored, weight,
       weight_locked, goal, target_range_min, target_range_max, zero_score_below,
       zero_score_above, normalisation_method, reducer_mode, true
FROM   held_criterion;

INSERT INTO criterion_scale_anchor (criterion, input_value, score, label)
SELECT judged.id, held.input_value, held.score, held.label
FROM   held_anchor AS held
JOIN   criterion AS judged
       ON judged.criteria_set = held.criteria_set AND judged.attribute = 'country.house_price_to_income_ratio';

INSERT INTO criterion_threshold_range (criterion, value_type, min_value, max_value)
SELECT judged.id, judged.value_type, held.min_value, held.max_value
FROM   held_threshold AS held
JOIN   criterion AS judged
       ON judged.criteria_set = held.criteria_set AND judged.attribute = 'country.house_price_to_income_ratio';
-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references -- which is what the attribute check below enforces.
DELETE FROM unit
WHERE  id = 'years_of_income'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'years_of_income');
