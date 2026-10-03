-- Back to an Index with no bounds, which can hold no value at all.
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.school_system_quality';
UPDATE criterion SET value_type = 'Index', normalisation_method = 'as_is'
WHERE  attribute = 'country.school_system_quality';
UPDATE attribute SET value_type = 'Index', description = 'OECD PISA mean score'
WHERE  id = 'country.school_system_quality';
-- The vocabulary row this added, removed. `ON CONFLICT DO NOTHING` on the way in means the
-- insert is idempotent and an existing row was left alone, so this deletes only what nothing
-- else now references -- which is what the attribute check below enforces.
DELETE FROM unit
WHERE  id = 'pisa_points'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'pisa_points');
