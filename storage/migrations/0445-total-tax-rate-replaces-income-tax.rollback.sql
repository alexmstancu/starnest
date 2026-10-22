-- **Locked first** (RE-2): the criteria copied below are then deleted, so a set edit
-- committed between the copy and the delete would be lost to the older copy. SHARE ROW
-- EXCLUSIVE waits for an edit in flight and holds off new ones until this commits, while
-- reads go on.
LOCK TABLE criterion IN SHARE ROW EXCLUSIVE MODE;

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
