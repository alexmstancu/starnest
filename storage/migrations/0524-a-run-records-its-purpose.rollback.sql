-- Undo 0524: a run stops recording its purpose.
--
-- **Refuses once any run has recorded one** (the 2026-10-22 rule, as 0512's way back does). A
-- purpose is a fact of the request that opened the run and cannot be re-derived from what the
-- run stored, so dropping it loses history no re-run gives back. Restore from the backup make
-- migrate took instead. Where nothing was recorded -- every fresh database, the test one
-- included -- the drop runs, so the path stays exercised.
--
-- **Locked before it counts** (BE-A1): a run opened between the count and the drop would escape
-- the refusal.
LOCK TABLE data_acquisition_run IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    recorded integer;
BEGIN
    SELECT count(*) INTO recorded FROM data_acquisition_run WHERE purpose IS NOT NULL;
    IF recorded > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0524: % run(s) recorded their purpose, which cannot be '
            're-derived. Restore from the backup make migrate took instead of forcing this.',
            recorded;
    END IF;
END $$;

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT IF EXISTS data_acquisition_run_purpose_is_known,
    DROP COLUMN IF EXISTS purpose;
