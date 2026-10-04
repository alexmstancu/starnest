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

-- **A figure's own rows go before the figure**, and this is the direction the comment below
-- about `value_attribute_fkey` does not cover. Eleven tables reference `value` and not one
-- cascades: the magnitude lives in `value_count` for a Count attribute and the pages it came
-- from live in `value_citation`, so deleting the figures alone fails on
-- `value_count_value_fkey` as soon as any have been acquired -- 310 of them had been. A
-- figure-free database deletes nothing here and so never notices.
--
-- `candidate_attribute_score.used_value` is deliberately not cleared: a saved evaluation is a
-- frozen record that must still explain its score (`0107`), so if one ever reads these figures
-- its foreign key should refuse this rollback rather than let it empty the record.
DELETE FROM value_citation
WHERE  value IN (SELECT id FROM value WHERE attribute = 'country.european_air_connectivity');

DELETE FROM value_count
WHERE  value_id IN (SELECT id FROM value WHERE attribute = 'country.european_air_connectivity');

DELETE FROM value                     WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute_source_priority WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute_allowed_range   WHERE attribute = 'country.european_air_connectivity';
DELETE FROM attribute                 WHERE id = 'country.european_air_connectivity';
