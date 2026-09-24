-- Back to four statuses and no way to ask a run to stop.
--
-- **Any run that was stopped becomes `failed`**, because the four remaining statuses have no
-- word for what happened to it. That is a loss of truth, which is the point of noting it here:
-- rolling this back does not merely remove a feature, it relabels history.
ALTER TABLE data_acquisition_run
    DROP CONSTRAINT data_acquisition_run_halted_by_user_was_asked_to_stop;

UPDATE data_acquisition_run SET run_status = 'failed' WHERE run_status = 'halted_by_user';

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT data_acquisition_run_status_is_known;

ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_status_is_known
        CHECK (run_status IN ('running', 'completed', 'halted_on_spend_cap', 'failed'));

ALTER TABLE data_acquisition_run DROP COLUMN stop_requested_at;
