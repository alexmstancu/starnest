-- Back to four statuses and no way to ask a run to stop.
--
-- **A run that was stopped would become `failed`**, because the four remaining statuses have
-- no word for what happened to it. That is a loss of truth: rolling this back would not merely
-- remove a feature, it would relabel history. So it refuses while any such run exists.

-- **Refuses once a run has been stopped or asked to stop** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE data_acquisition_run IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    stopped integer;
BEGIN
    SELECT count(*) INTO stopped
    FROM   data_acquisition_run
    WHERE  run_status = 'halted_by_user' OR stop_requested_at IS NOT NULL;
    IF stopped > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0483: % run(s) were stopped or asked to stop by a person, and '
            'this relabels them failed and drops when they were asked. Run history is not '
            'rewritten (FU-A5), so restore from the backup make migrate took instead of forcing '
            'this.', stopped;
    END IF;
END $$;

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT data_acquisition_run_halted_by_user_was_asked_to_stop;

UPDATE data_acquisition_run SET run_status = 'failed' WHERE run_status = 'halted_by_user';

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT data_acquisition_run_status_is_known;

ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_status_is_known
        CHECK (run_status IN ('running', 'completed', 'halted_on_spend_cap', 'failed'));

ALTER TABLE data_acquisition_run DROP COLUMN stop_requested_at;
