-- Back to the undecided, unapplied rule: both condition bands NULL, is_applied false.

UPDATE criteria_set_compound_rule
SET    is_applied = false
WHERE  criteria_set = 'local_employment'
  AND  compound_rule = 'mild_now_brutal_later';

UPDATE compound_rule_condition
SET    threshold_min = NULL, threshold_max = NULL
WHERE  compound_rule = 'mild_now_brutal_later'
  AND  attribute IN ('country.avg_annual_temperature', 'country.projected_summer_heat_days');
