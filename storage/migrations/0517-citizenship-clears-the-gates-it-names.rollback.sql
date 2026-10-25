-- Undo 0517: citizenship clears no gate again, and EU free movement is derived from nothing.
--
-- **It refuses while anything recorded depends on 0517**: an answer's assumed citizenships are
-- what flags it for a re-check, and a saved ranking's refusal or warning decided by citizenship
-- read no answer, so dropping the columns would leave it explaining nothing -- and a warning with
-- no answer would break the NOT NULL put back below. The catalog rows go quietly: they are
-- 0517's own seed.
--
-- **Locked before it counts** (BE-A1): a row committed between the count and the drop would
-- escape the refusal.
LOCK TABLE match_rule, match_rule_candidate, match_rule_answer_citizenship,
           evaluation_citizenship, non_match_reason, candidate_gate_warning
    IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    assumed integer;
    frozen  integer;
BEGIN
    SELECT count(*) INTO assumed FROM match_rule_answer_citizenship;
    SELECT (SELECT count(*) FROM non_match_reason WHERE decided_by_citizenship)
         + (SELECT count(*) FROM candidate_gate_warning WHERE decided_by_citizenship)
    INTO   frozen;

    IF assumed + frozen > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0517: % gate answer citizenship(s) and % saved-ranking row(s) '
            'decided by citizenship depend on it. Restore from the backup make migrate took '
            'instead of forcing this.', assumed, frozen;
    END IF;
END $$;

ALTER TABLE candidate_gate_warning
    DROP CONSTRAINT IF EXISTS candidate_gate_warning_reads_an_answer_or_the_citizenships;
ALTER TABLE candidate_gate_warning ALTER COLUMN match_rule_answer SET NOT NULL;
ALTER TABLE candidate_gate_warning DROP COLUMN IF EXISTS decided_by_citizenship;
ALTER TABLE non_match_reason DROP COLUMN IF EXISTS decided_by_citizenship;

DROP TABLE IF EXISTS evaluation_citizenship;
DROP TABLE IF EXISTS match_rule_answer_citizenship;

DELETE FROM match_rule_candidate WHERE match_rule = 'eu_free_movement';

ALTER TABLE match_rule DROP COLUMN IF EXISTS decided_by_citizenship;

DROP TABLE IF EXISTS match_rule_clearing_citizenship;
