DELETE FROM criterion
WHERE criteria_set = 'minimal' AND attribute = 'country.healthcare_system_quality';

DELETE FROM pillar_weight WHERE criteria_set = 'minimal' AND pillar = 'health';

UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 25 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'career';
