DELETE FROM criterion WHERE attribute = 'country.cost_of_living_index';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.cost_of_living_index';

UPDATE attribute
SET    value_type = 'Index', description = 'Eurostat PLI, EU27 = 100'
WHERE  id = 'country.cost_of_living_index';

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'local_employment', a.id, a.pillar, a.value_type, true, 35, 'minimise', 'as_is', true
FROM   attribute AS a
WHERE  a.id = 'country.cost_of_living_index';
