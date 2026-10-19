-- Drop the gate-research spend ledger.
--
-- **Refuses once anything has been ledgered.** A row is a record of money already spent, and no
-- run, no response and no source can give it back -- the one kind of row here that cannot be
-- re-fetched at any price. On a database that has researched nothing -- every fresh one, the test
-- database included -- there are no rows and the drop runs, keeping the path exercised.

DO $$
DECLARE
    ledgered integer;
BEGIN
    SELECT count(*) INTO ledgered FROM match_rule_research_spend;
    IF ledgered > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0503: % billed research call(s) are ledgered, a record of money '
            'spent that cannot be re-fetched. Restore from the backup make migrate took instead '
            'of forcing this.', ledgered;
    END IF;
END $$;

DROP TABLE IF EXISTS match_rule_research_spend;
