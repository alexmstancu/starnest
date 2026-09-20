-- Back to an Index with no bounds, which can hold no value at all.
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.school_system_quality';
UPDATE criterion SET value_type = 'Index', normalisation_method = 'as_is'
WHERE  attribute = 'country.school_system_quality';
UPDATE attribute SET value_type = 'Index', description = 'OECD PISA mean score'
WHERE  id = 'country.school_system_quality';
