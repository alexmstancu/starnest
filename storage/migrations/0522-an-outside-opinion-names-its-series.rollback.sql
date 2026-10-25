-- Undo 0522: an outside opinion is identified by its publisher and period again, with no series.
--
-- **Refuses while two series of one publisher share a period**: without the series they are the
-- same row twice, and which to keep is not a rollback's to decide. Otherwise it loses only the
-- series' names, which nothing before 0522 could hold. Locked first, so a row written between
-- the check and the key cannot slip past the refusal.

LOCK TABLE external_score IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s by %s for %s to %s (series %s)', candidate, data_source,
                             reference_period_start, reference_period_end,
                             array_to_string(series_named, ', ')),
                      '; ')
    INTO   offenders
    FROM  (SELECT candidate, data_source, reference_period_start, reference_period_end,
                  array_agg(series ORDER BY series) AS series_named
           FROM   external_score
           GROUP  BY candidate, data_source, reference_period_start, reference_period_end,
                     retrieval_date
           HAVING count(*) > 1) AS several;
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0522: without a series these editions would collide: %. Delete '
            'all but one of each, then roll back again. Nothing was changed.', offenders;
    END IF;
END $$;

ALTER TABLE external_score
    DROP CONSTRAINT IF EXISTS external_score_natural_key,
    ADD CONSTRAINT external_score_natural_key
        UNIQUE (candidate, data_source, reference_period_start, reference_period_end,
                retrieval_date),
    DROP CONSTRAINT IF EXISTS external_score_series_names_something,
    DROP COLUMN IF EXISTS series;
