-- Drop the three frozen columns, returning the snapshot to reading `value_type` live and
-- dropping lock and threshold on read. Touches `evaluation_criterion`, the table the forward
-- step altered.

-- **Refuses once a saved ranking has frozen a criterion** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE evaluation_criterion IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    frozen integer;
BEGIN
    SELECT count(*) INTO frozen FROM evaluation_criterion;
    IF frozen > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0500: % saved-evaluation criterion row(s) freeze the value type, '
            'weight lock and matching threshold a ranking was computed with, and this drops '
            'those columns. A saved evaluation must still explain its score (0107), so restore '
            'from the backup make migrate took instead of forcing this.', frozen;
    END IF;
END $$;

ALTER TABLE evaluation_criterion
    DROP CONSTRAINT IF EXISTS evaluation_criterion_value_type_is_known;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS value_type;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS weight_locked;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS matching_threshold;
