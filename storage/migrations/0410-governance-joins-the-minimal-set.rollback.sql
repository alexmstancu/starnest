-- Back to the three Eurostat criteria `0121` created, and the 60/40 split that described them.
DELETE FROM criterion
WHERE criteria_set = 'minimal'
  AND attribute IN ('country.rule_of_law', 'country.control_of_corruption',
                    'country.political_economic_stability');

DELETE FROM pillar_weight
WHERE criteria_set = 'minimal' AND pillar IN ('governance', 'safety');

UPDATE pillar_weight SET weight = 60 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 40 WHERE criteria_set = 'minimal' AND pillar = 'culture';
