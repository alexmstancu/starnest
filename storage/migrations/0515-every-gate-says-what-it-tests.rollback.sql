-- Undo 0515: the gates lose their descriptions. They are catalog text the forward step seeds
-- again, so nothing a person recorded is lost and nothing needs refusing.
--
-- **Locked first** (BE-A1), as the forward step was.
LOCK TABLE match_rule IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE match_rule DROP CONSTRAINT IF EXISTS match_rule_says_what_it_tests;
ALTER TABLE match_rule DROP COLUMN IF EXISTS description;
