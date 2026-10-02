-- Back to a purchase ratio nothing can answer, carrying whatever weight the replacement held.
UPDATE attribute SET lifecycle_status = 'active'
WHERE  id = 'country.house_price_to_income_ratio';

INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
SELECT replacing.criteria_set, 'country.house_price_to_income_ratio', 'Quantity', 'housing',
       replacing.weight, 'minimise', 'percentile', true, false, false
FROM   criterion AS replacing
WHERE  replacing.attribute = 'country.housing_price_level';

DELETE FROM criterion WHERE attribute = 'country.housing_price_level';
DELETE FROM stand_in WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute_source_priority WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute WHERE id = 'country.housing_price_level';
