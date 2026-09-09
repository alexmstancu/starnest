UPDATE attribute SET lifecycle_status = 'active' WHERE id = 'country.crime_safety_index';

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'local_employment', a.id, a.pillar, a.value_type, true, old.weight, 'maximise',
       old.normalisation_method, old.blocks_if_missing
FROM   attribute AS a
JOIN   criterion AS old
       ON old.criteria_set = 'local_employment' AND old.attribute = 'country.homicide_rate'
WHERE  a.id = 'country.crime_safety_index'
ON CONFLICT (criteria_set, attribute) DO NOTHING;

DELETE FROM criterion
WHERE criteria_set = 'local_employment' AND attribute = 'country.homicide_rate';
DELETE FROM attribute_source_priority WHERE attribute = 'country.homicide_rate';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.homicide_rate';
DELETE FROM attribute WHERE id = 'country.homicide_rate';
