-- The old key holds one failure per item, so where two sources failed on one item only one
-- message would survive the rollback -- which is exactly the loss this migration was written to
-- end. So it refuses while any failure is recorded.

-- **Refuses once a failure has been recorded** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE data_acquisition_failure IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    failures integer;
BEGIN
    SELECT count(*) INTO failures FROM data_acquisition_failure;
    IF failures > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0461: % recorded failure(s) name the source that failed, and '
            'this drops that column and keeps one message per item. Run history is not '
            'rewritten (FU-A5), so restore from the backup make migrate took instead of forcing '
            'this.', failures;
    END IF;
END $$;

DELETE FROM data_acquisition_failure AS later
USING  data_acquisition_failure AS kept
WHERE  later.data_acquisition_run = kept.data_acquisition_run
  AND  later.candidate = kept.candidate
  AND  later.attribute = kept.attribute
  AND  later.data_source > kept.data_source;

ALTER TABLE data_acquisition_failure DROP CONSTRAINT data_acquisition_failure_pkey;
ALTER TABLE data_acquisition_failure ADD CONSTRAINT data_acquisition_failure_pkey
    PRIMARY KEY (data_acquisition_run, candidate, attribute);
ALTER TABLE data_acquisition_failure DROP COLUMN data_source;
