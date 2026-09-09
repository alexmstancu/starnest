-- Back to the four pillars `0410` left behind.
DELETE FROM criterion
WHERE criteria_set = 'minimal'
  AND attribute IN ('country.tech_employment_share', 'country.broadband_coverage');

DELETE FROM pillar_weight
WHERE criteria_set = 'minimal' AND pillar IN ('career', 'connectivity');

UPDATE pillar_weight SET weight = 30 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 30 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'safety';
