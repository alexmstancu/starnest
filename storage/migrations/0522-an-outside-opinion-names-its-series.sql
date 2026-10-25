-- An outside opinion names which of its publisher's indices it is an edition of (PL-171: ST-10;
-- decision D64).
--
-- depends: 0521-a-converted-amount-names-who-published-its-rate
--
-- **Nothing said which index a row belonged to**, so "the current edition" -- the latest per
-- candidate and publisher, as reqs.md 3.5a put it -- would have read Numbeo's Quality of Life
-- Index as the history of its Crime Index. `series` names the index, and the natural key gains
-- it: two series of one publisher for one period are two editions, and neither displaces the
-- other. Which edition is current stays derived, never stored (`data/external_score.py`).
--
-- **A stored outside opinion stops the migration and is named**: no column says which series
-- an existing row belongs to, and `published_scale` is wording, not identity -- inferring from
-- it would split one index on a rewording and merge two on one scale. No production code writes
-- `external_score`, so the live table is expected empty. Note each named row's series, delete
-- the rows, migrate, and store them again with their series. No numeric column is added, so
-- `0518`'s finite rule has nothing new to hold.

-- **Locked first, and exclusively** (BE-A1): a row written between the check and the NOT NULL
-- would meet a raw violation rather than the refusal below. ACCESS EXCLUSIVE, because the table
-- is altered, which takes it anyway.
LOCK TABLE external_score IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s by %s for %s to %s (id %s)', candidate, data_source,
                             reference_period_start, reference_period_end, id),
                      '; ' ORDER BY id)
    INTO   offenders
    FROM   external_score;
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0522: every outside opinion names the series it is an edition of, and '
            'nothing says which series these belong to: %. Note each one''s series, delete them, '
            'migrate again and store them again with it; this migration will not guess. Nothing '
            'was changed.', offenders;
    END IF;
END $$;

ALTER TABLE external_score
    ADD COLUMN series text NOT NULL,
    ADD CONSTRAINT external_score_series_names_something CHECK (btrim(series) <> ''),
    DROP CONSTRAINT external_score_natural_key,
    ADD CONSTRAINT external_score_natural_key
        UNIQUE (candidate, data_source, series, reference_period_start, reference_period_end,
                retrieval_date);

COMMENT ON COLUMN external_score.series IS
    'Which of the publisher''s indices this is an edition of -- Crime Index, Quality of Life Index. The current edition is the latest per candidate, publisher and series, derived and never stored (reqs.md 3.5a, D64).';
