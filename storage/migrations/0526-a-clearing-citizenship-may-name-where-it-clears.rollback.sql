-- Undo 0526: a clearing citizenship clears a gate everywhere it asks again, and a British one no
-- longer clears free movement in Ireland.
--
-- Takes back only catalog rows: every scoped row is 0526's own seed, since the catalog changes
-- only by migration. The partial index on unscoped rows guarantees the old key holds again.
--
-- **Locked first** (BE-A1): a scoped row written between the delete and the key would break it.
LOCK TABLE match_rule_clearing_citizenship IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM match_rule_clearing_citizenship WHERE applies_in_candidate IS NOT NULL;

DROP INDEX IF EXISTS match_rule_clearing_citizenship_in_each_place_once;
DROP INDEX IF EXISTS match_rule_clearing_citizenship_everywhere_once;

ALTER TABLE match_rule_clearing_citizenship
    DROP CONSTRAINT IF EXISTS match_rule_clearing_citizenship_applies_where_the_gate_asks;
ALTER TABLE match_rule_clearing_citizenship DROP COLUMN IF EXISTS applies_in_candidate;

ALTER TABLE match_rule_clearing_citizenship
    ADD CONSTRAINT match_rule_clearing_citizenship_pkey PRIMARY KEY (match_rule, candidate);
