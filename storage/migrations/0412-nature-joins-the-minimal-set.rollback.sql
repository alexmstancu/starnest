DELETE FROM criterion WHERE criteria_set = 'minimal' AND attribute = 'country.protected_land_share';
DELETE FROM pillar_weight WHERE criteria_set = 'minimal' AND pillar = 'nature';

UPDATE pillar_weight SET weight = 18 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 13 WHERE criteria_set = 'minimal' AND pillar = 'career';
UPDATE pillar_weight SET weight = 10 WHERE criteria_set = 'minimal' AND pillar = 'connectivity';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'health';
