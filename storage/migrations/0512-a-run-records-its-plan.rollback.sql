-- Undo 0512: a run stops recording its plan, its ceiling and its cap.
--
-- **Refuses once any run has recorded one** (the 2026-10-22 rule, as 0511's way back does). A
-- plan says which sources a run finished, and so which of its empty items nobody had a row for
-- and which were never asked; a ceiling and a cap say what the run was allowed to spend. Neither
-- can be re-derived from anything else, so dropping them loses history no re-run gives back.
-- Restore from the backup make migrate took instead. Where nothing was recorded -- every fresh
-- database, the test one included -- the drop runs, so the path stays exercised.
--
-- **Locked before it counts** (BE-A1): a run opened between the count and the drop would escape
-- the refusal.
LOCK TABLE data_acquisition_run, data_acquisition_run_plan IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    planned integer;
BEGIN
    SELECT count(*) INTO planned
    FROM   data_acquisition_run
    WHERE  plan_recorded_at IS NOT NULL
       OR  EXISTS (SELECT 1 FROM data_acquisition_run_plan AS p
                   WHERE  p.data_acquisition_run = data_acquisition_run.id);
    IF planned > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0512: % run(s) recorded their plan, ceiling and cap, which cannot '
            'be re-derived. Restore from the backup make migrate took instead of forcing this.',
            planned;
    END IF;
END $$;

DROP TABLE IF EXISTS data_acquisition_run_plan;
ALTER TABLE data_acquisition_run
    DROP CONSTRAINT IF EXISTS data_acquisition_run_plan_is_recorded_whole,
    DROP CONSTRAINT IF EXISTS data_acquisition_run_spend_cap_eur_is_finite,
    DROP CONSTRAINT IF EXISTS data_acquisition_run_estimate_ceiling_eur_is_finite,
    DROP COLUMN IF EXISTS accepted_uncapped,
    DROP COLUMN IF EXISTS spend_cap_eur,
    DROP COLUMN IF EXISTS estimate_ceiling_eur,
    DROP COLUMN IF EXISTS plan_recorded_at;
