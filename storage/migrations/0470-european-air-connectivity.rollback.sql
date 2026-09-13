-- Remove the European air attribute and give the international one back the whole weight.
--
-- The order matters: the criteria go before the attribute they judge, and the weight is
-- restored in the same statement pass, so the connectivity pillar never sits at 87.

DELETE FROM criterion WHERE attribute = 'country.european_air_connectivity';

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 25),
    ('remote_only',      30)
) AS declared (criteria_set, weight)
WHERE  criterion.attribute = 'country.international_air_connectivity'
  AND  criterion.criteria_set = declared.criteria_set;

DELETE FROM value                     WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute_source_priority WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute_allowed_range   WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute                 WHERE id = 'country.european_air_connectivity';
