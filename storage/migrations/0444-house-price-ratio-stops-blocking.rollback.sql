-- **Locked first** (BE-A1): a set edit committed between the copy below and its delete was
-- replaced by the older copy. SHARE ROW EXCLUSIVE waits for an edit in flight and holds off
-- new ones until this commits, while reads go on.
LOCK TABLE criterion IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE held_criterion ON COMMIT DROP AS
SELECT * FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';

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
-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references -- which is what the attribute check below enforces.
DELETE FROM unit
WHERE  id = 'years_of_income'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'years_of_income');
