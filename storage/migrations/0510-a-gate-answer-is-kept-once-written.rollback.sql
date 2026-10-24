-- Undo 0510: back to one mutable gate answer per pair, and saved refusals that cite nothing.
--
-- **Refuses once any history or saved evidence exists** (FU-A5's rule). History is a version
-- that is not its pair's live answer -- a correction, or a proposal a person replaced -- and
-- saved evidence is a refusal that cites a version or a figure. Dropping either loses what can
-- never be re-fetched. Restore from the backup make migrate took instead. On a database where
-- every version is still its pair's live one and nothing cites them -- every fresh one, the test
-- database included -- the drop runs, so the path stays exercised.
--
-- **Locked before it counts** (BE-A1): a correction or a save committed between the count and the
-- drop would escape the refusal.
LOCK TABLE match_rule_answer, match_rule_answer_citation, match_rule_result, non_match_reason
           IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    history  integer;
    evidence integer;
BEGIN
    SELECT count(*) INTO history
    FROM   match_rule_answer AS version
    WHERE  NOT EXISTS (SELECT 1 FROM match_rule_result AS live WHERE live.answer = version.id);

    SELECT count(*) INTO evidence
    FROM   non_match_reason
    WHERE  match_rule_answer IS NOT NULL OR used_value IS NOT NULL;

    IF history > 0 OR evidence > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0510: % earlier gate answer(s) and % saved refusal(s) citing their '
            'evidence would be lost, and neither can be re-fetched. Restore from the backup make '
            'migrate took instead of forcing this.', history, evidence;
    END IF;
END $$;

ALTER TABLE non_match_reason DROP CONSTRAINT IF EXISTS non_match_reason_only_a_threshold_names_one_figure;
ALTER TABLE non_match_reason DROP CONSTRAINT IF EXISTS non_match_reason_only_a_gate_names_an_answer;
ALTER TABLE non_match_reason DROP CONSTRAINT IF EXISTS non_match_reason_cites_a_stored_figure;
ALTER TABLE non_match_reason DROP CONSTRAINT IF EXISTS non_match_reason_cites_a_version_of_its_gate;
ALTER TABLE non_match_reason DROP COLUMN IF EXISTS used_value;
ALTER TABLE non_match_reason DROP COLUMN IF EXISTS match_rule_answer;

ALTER TABLE match_rule_result DROP CONSTRAINT IF EXISTS match_rule_result_shows_a_version_of_its_pair;
ALTER TABLE match_rule_result DROP COLUMN IF EXISTS answer;

DROP TABLE IF EXISTS match_rule_answer_citation;
DROP TABLE IF EXISTS match_rule_answer;
