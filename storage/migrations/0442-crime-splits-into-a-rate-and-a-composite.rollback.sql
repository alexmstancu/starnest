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
-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references -- which is what the attribute check below enforces.
DELETE FROM unit
WHERE  id = 'per_100000_population'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'per_100000_population');
