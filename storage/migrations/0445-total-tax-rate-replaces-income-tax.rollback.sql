UPDATE attribute SET lifecycle_status = 'active' WHERE id = 'country.income_tax_effective';

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT new.criteria_set, 'country.income_tax_effective', new.pillar, 'Ratio', new.is_scored,
       new.weight, new.goal, new.normalisation_method, new.blocks_if_missing
FROM   criterion AS new
WHERE  new.attribute = 'country.total_tax_rate_effective';

DELETE FROM criterion WHERE attribute = 'country.total_tax_rate_effective';
DELETE FROM attribute_source_priority WHERE attribute = 'country.total_tax_rate_effective';
DELETE FROM attribute_ratio_parameter WHERE attribute = 'country.total_tax_rate_effective';
DELETE FROM attribute WHERE id = 'country.total_tax_rate_effective';
