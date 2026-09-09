DELETE FROM criterion WHERE criteria_set = 'minimal' AND attribute = 'country.economic_outlook';
DELETE FROM pillar_weight WHERE criteria_set = 'minimal' AND pillar = 'economics';

UPDATE pillar_weight SET weight = 16 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 10 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 18 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 11 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'career';
UPDATE pillar_weight SET weight =  9 WHERE criteria_set = 'minimal' AND pillar = 'connectivity';
UPDATE pillar_weight SET weight = 14 WHERE criteria_set = 'minimal' AND pillar = 'health';
UPDATE pillar_weight SET weight = 10 WHERE criteria_set = 'minimal' AND pillar = 'nature';
