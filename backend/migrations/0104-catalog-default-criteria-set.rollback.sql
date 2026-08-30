-- Remove the shipped default criteria set. An evaluation computed against it is held by a
-- foreign key, so a set with saved results behind it cannot be removed by accident.

DELETE FROM criteria_set_compound_rule WHERE criteria_set = 'local_employment';
DELETE FROM criteria_set_match_rule    WHERE criteria_set = 'local_employment';
DELETE FROM criterion                  WHERE criteria_set = 'local_employment';
DELETE FROM pillar_weight              WHERE criteria_set = 'local_employment';
DELETE FROM criteria_set               WHERE id = 'local_employment';
