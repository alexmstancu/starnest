-- Back to undecided and unapplied, which is how the rule shipped.

DELETE FROM criteria_set_compound_rule
WHERE  criteria_set = 'local_employment' AND compound_rule = 'cheap_but_taxed';

UPDATE compound_rule_condition
SET    threshold_min = NULL, threshold_max = NULL
WHERE  compound_rule = 'cheap_but_taxed';
