-- Remove the Liechtenstein quota gate.
--
-- **Refuses once the gate has been answered for any candidate.** A `match_rule_result` row (and
-- its citations) is a hand-recorded judgement that cannot be re-fetched -- the manual-entry value
-- reqs.md 10 protects above every other. Deleting the rule would cascade into or orphan those
-- answers, so this refuses with the remedy rather than destroying them. On a database that has
-- answered nothing -- every fresh one, the test database included -- there are no such rows and
-- the delete runs, keeping the path exercised.

DO $$
DECLARE
    answered integer;
BEGIN
    SELECT count(*) INTO answered
    FROM   match_rule_result WHERE match_rule = 'li_eea_quota';
    IF answered > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0493: % answer(s) are recorded for the li_eea_quota gate, which '
            'are hand-entered judgements that cannot be re-fetched. Restore from the backup '
            'make migrate took instead of forcing this.', answered;
    END IF;
END $$;

DELETE FROM match_rule WHERE id = 'li_eea_quota';
