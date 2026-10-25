-- Drop the reuse table, returning the accounting to counting a re-confirmed transcribed figure
-- as unanswered. Touches `data_acquisition_run_reuse`, the table the forward step created.

-- **Refuses once a run has recorded a reuse** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE data_acquisition_run_reuse IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    reused integer;
BEGIN
    SELECT count(*) INTO reused FROM data_acquisition_run_reuse;
    IF reused > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0501: % reuse row(s) record which figures a run re-confirmed, and '
            'this drops the table that holds them, so those runs would read as unanswered. '
            'Restore from the backup make migrate took instead of forcing this.', reused;
    END IF;
END $$;

DROP TABLE IF EXISTS data_acquisition_run_reuse;
