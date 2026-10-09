-- Back to the undecided, unapplied rule: both condition bands NULL, and the rule off.
-- Off is the absence of a row (a set stores only the rules it applies), so the association is
-- deleted rather than set false -- undoing the forward upsert to the state it found.

DELETE FROM criteria_set_compound_rule
WHERE  criteria_set = 'local_employment'
  AND  compound_rule = 'mild_now_brutal_later';

UPDATE compound_rule_condition
SET    threshold_min = NULL, threshold_max = NULL
WHERE  compound_rule = 'mild_now_brutal_later'
  AND  attribute IN ('country.avg_annual_temperature', 'country.projected_summer_heat_days');
