-- Drop the warning-input table, returning a saved warning to text without its source chain.
-- Touches `candidate_warning_input`, the table the forward step created.

-- **Refuses once a saved warning has recorded its figures** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE candidate_warning_input IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    inputs integer;
BEGIN
    SELECT count(*) INTO inputs FROM candidate_warning_input;
    IF inputs > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0504: % saved warning input row(s) record the figures behind a '
            'saved warning, and this drops the table that holds them. A saved evaluation must '
            'still explain its score (0107), so restore from the backup make migrate took '
            'instead of forcing this.', inputs;
    END IF;
END $$;

DROP TABLE IF EXISTS candidate_warning_input;
