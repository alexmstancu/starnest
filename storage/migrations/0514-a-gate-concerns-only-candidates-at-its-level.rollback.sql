-- Undo 0514: the concerned candidates lose their level and the two keys that held it. Both are
-- catalog facts the forward step derived and can derive again, so nothing a person recorded is
-- lost and nothing needs refusing.
--
-- **Locked first** (BE-A1), in the order the forward step took them.
LOCK TABLE match_rule_candidate, match_rule IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE match_rule_candidate DROP CONSTRAINT IF EXISTS match_rule_candidate_sits_at_its_gate_s_level;
ALTER TABLE match_rule_candidate DROP CONSTRAINT IF EXISTS match_rule_candidate_is_asked_at_its_gate_s_level;
ALTER TABLE match_rule_candidate DROP COLUMN IF EXISTS level;

ALTER TABLE match_rule DROP CONSTRAINT IF EXISTS match_rule_level_key;
