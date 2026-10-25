-- Remove the Liechtenstein quota gate.
--
-- **Refuses once the gate has been answered for any candidate.** A `match_rule_result` row (and
-- its citations) is a hand-recorded judgement that cannot be re-fetched -- the manual-entry value
-- reqs.md 10 protects above every other. Deleting the rule would cascade into or orphan those
-- answers, so this refuses with the remedy rather than destroying them. On a database that has
-- answered nothing -- every fresh one, the test database included -- there are no such rows and
-- the delete runs, keeping the path exercised.

-- **Locked before it counts** (BE-A1): an answer recorded, or a set made to enforce the gate,
-- between the count and the delete met a raw foreign-key error rather than a refusal. SHARE ROW EXCLUSIVE waits for a write
-- in flight and holds off new ones until this commits, while reads go on.
LOCK TABLE match_rule_result, criteria_set_match_rule IN SHARE ROW EXCLUSIVE MODE;

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

-- **Refuses while another set still enforces the gate** (P95). `0494`'s rollback disarms it on
-- `local_employment` only, and the Rules panel or a duplicated set can enforce it anywhere; the
-- delete below then met a raw foreign-key error. Turning a gate off is a person's choice, so
-- this names the sets rather than switching it off for them.
DO $$
DECLARE
    enforcing integer;
    sets      text;
BEGIN
    SELECT count(*), string_agg(criteria_set, ', ' ORDER BY criteria_set)
    INTO   enforcing, sets
    FROM   criteria_set_match_rule WHERE match_rule = 'li_eea_quota';
    IF enforcing > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0493: the li_eea_quota gate is still enforced by % criteria '
            'set(s) (%), and this deletes the gate. Turn it off in those sets (Configure, '
            'Rules) and roll back again, or restore from the backup make migrate took.',
            enforcing, sets;
    END IF;
END $$;

DELETE FROM match_rule WHERE id = 'li_eea_quota';
