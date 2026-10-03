CREATE TEMPORARY TABLE held_criterion ON COMMIT DROP AS
SELECT * FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';

DELETE FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.house_price_to_income_ratio';

UPDATE attribute SET value_type = 'Ratio', description = 'price ÷ annual income'
WHERE id = 'country.house_price_to_income_ratio';

INSERT INTO attribute_ratio_parameter (attribute, value_type, basis)
VALUES ('country.house_price_to_income_ratio', 'Ratio', 'annual_income');

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT criteria_set, attribute, pillar, 'Ratio', is_scored, weight, goal, normalisation_method, true
FROM   held_criterion;
-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references -- which is what the attribute check below enforces.
DELETE FROM unit
WHERE  id = 'years_of_income'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'years_of_income');
