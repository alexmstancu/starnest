-- Undo the extra freeze, returning a reopened ranking to live pillar locks, no recorded rule
-- lists, and a not_matching rule with no input chain. Touches the two columns and three tables
-- 0507 added.

DROP TABLE IF EXISTS non_match_input;
DROP TABLE IF EXISTS evaluation_compound_rule;
DROP TABLE IF EXISTS evaluation_match_rule;

ALTER TABLE candidate_warning_input DROP COLUMN IF EXISTS ordinal;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS pillar_weight_locked;
