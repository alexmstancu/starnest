-- Somebody can stop a run, and the run says so afterwards.
--
-- **A fifth status, not a reuse of one of the four.** `halted_on_spend_cap` means the money ran
-- out; `failed` means it broke. A run a person stopped is neither, and recording it as either
-- would make the history lie about why the figures stop where they do -- which matters most
-- precisely when somebody comes back to a half-filled corpus and asks what happened.
--
-- **`stop_requested_at` is a timestamp rather than a flag**, for the same reason every value
-- carries two dates: a nullable timestamp answers "was it asked for" and "when" in one column,
-- and the second question is the one a reader has when a stop took a while to take effect.
--
-- **Nothing is lost by stopping.** The acquisition loop reads this between items, so whatever
-- had completed is already written -- the same guarantee the spend cap gives, which Gate D
-- proves by killing a process mid-run.
ALTER TABLE data_acquisition_run
    ADD COLUMN stop_requested_at timestamptz;

COMMENT ON COLUMN data_acquisition_run.stop_requested_at IS
    'When a person asked for this run to stop. The loop reads it between items, so everything '
    'that had completed is already written. Null means nobody asked.';

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT data_acquisition_run_status_is_known;

ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_status_is_known
        CHECK (run_status IN ('running', 'completed', 'halted_on_spend_cap', 'halted_by_user',
                              'failed'));

-- A run that ended because somebody stopped it must have been asked to stop. The reverse is not
-- required: a stop asked for while the last item was already in flight leaves a run that
-- completed, which is the honest outcome and not a failure of the stop.
ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_halted_by_user_was_asked_to_stop
        CHECK (run_status <> 'halted_by_user' OR stop_requested_at IS NOT NULL);
