DELETE FROM criterion WHERE criteria_set = 'minimal' AND attribute = 'country.cost_of_living_index';
UPDATE criterion SET weight = 100
WHERE criteria_set = 'minimal' AND attribute = 'country.economic_outlook';
