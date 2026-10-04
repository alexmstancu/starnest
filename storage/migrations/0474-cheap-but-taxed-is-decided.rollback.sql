-- Back to undecided and unapplied, which is how the rule shipped.
--
-- **Unapplied, not absent.** The forward migration upserts, and the row it lands on was seeded
-- by `0104` as `('local_employment', 'cheap_but_taxed', false)` -- so the migration updates a
-- row it did not create. Deleting it here undid `0104` as well, leaving the catalog short of a
-- row a different migration owns: the rule vanished from the set's list instead of appearing in
-- it switched off, and nothing downstream could tell the difference between "this set has
-- considered the rule and declined it" and "nobody has asked".

UPDATE criteria_set_compound_rule
SET    is_applied = false
WHERE  criteria_set = 'local_employment' AND compound_rule = 'cheap_but_taxed';

UPDATE compound_rule_condition
SET    threshold_min = NULL, threshold_max = NULL
WHERE  compound_rule = 'cheap_but_taxed';
