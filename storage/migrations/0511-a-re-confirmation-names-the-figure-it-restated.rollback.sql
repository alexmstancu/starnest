-- Undo 0511: a re-confirmation names its pair again, and not the figure it restated.
--
-- **Refuses once any re-confirmation names a figure** (FU-A5's rule). Which row a run restated is
-- known only when it was recorded: the backfill can rebuild it where one row qualifies and never
-- where two do, so dropping the column loses what no re-run can give back. Restore from the
-- backup make migrate took instead. Where nothing is named -- every fresh database, the test one
-- included -- the drop runs, so the path stays exercised.
--
-- **Locked before it counts** (BE-A1): a re-confirmation recorded between the count and the drop
-- would escape the refusal.
LOCK TABLE data_acquisition_run_reuse IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    named integer;
BEGIN
    SELECT count(*) INTO named FROM data_acquisition_run_reuse WHERE value IS NOT NULL;
    IF named > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0511: % re-confirmation(s) name the figure they restated, which '
            'cannot be re-derived. Restore from the backup make migrate took instead of forcing '
            'this.', named;
    END IF;
END $$;

ALTER TABLE data_acquisition_run_reuse
    DROP CONSTRAINT IF EXISTS data_acquisition_run_reuse_names_a_stored_figure;
ALTER TABLE data_acquisition_run_reuse DROP COLUMN IF EXISTS value;
