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
