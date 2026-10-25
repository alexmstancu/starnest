-- A run's evidence is pinned to its items, its items to its scope, and its scope to its level
-- (PL-048: ST-12, SV-N10).
--
-- depends: 0516-a-set-holds-each-rule-as-a-gate-or-a-warning
--
-- Each kind of evidence a run leaves -- a value carrying its id (0005), a failure (0004, 0461),
-- a re-confirmation (0501) -- named the catalog through single-column keys, and nothing tied it to
-- the pairs the run had asked about (0506). The scope lists carried no level at all. So a figure
-- for Greece could carry a run that asked about Portugal only, and a city could be planned into a
-- country run; the reads now ignore such rows (PL-042), and this makes them impossible.
--
-- **Keys, in the idiom `candidate_level_key` set** (0002, 0108, 0460, 0514), never a trigger:
-- - the run gains `UNIQUE (id, level)`;
-- - both scope lists carry the run's level, copied from the run, and must sit at it -- the
--   candidate through `candidate_level_key`, the attribute through `attribute_level_key` (0460;
--   reused, never a second key, SV-N10);
-- - an item's candidate and attribute must be in the run's two lists;
-- - a value, failure or re-confirmation carrying a run must be one of that run's items. A value
--   with no run is untouched: `MATCH SIMPLE` checks nothing when the run is null. A plan row is
--   already held to the run's attributes (0512), and so now to its level.
--
-- **It refuses before changing anything** when a row breaks a rule, naming each kind with its
-- count and one example, and **while any run is running**: validating the keys holds the tables,
-- and a run in flight would meet a refusal mid-write. Rows found outside their run's items are
-- not repaired here (D15): a separate migration records them as items if the rehearsal finds any.

-- **Locked first** (BE-A1, P98): the check reads every table it then keys, and the backfill copies
-- the run's level, so a row written in between would escape the check or break a key.
LOCK TABLE data_acquisition_run,
           data_acquisition_run_candidate,
           data_acquisition_run_attribute,
           data_acquisition_run_item,
           data_acquisition_failure,
           data_acquisition_run_reuse,
           value,
           candidate,
           attribute
    IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s: %s, e.g. %s', kind, how_many, example), '; ' ORDER BY kind)
    INTO   offenders
    FROM (
        SELECT 'a run still running' AS kind, count(*) AS how_many,
               min(format('run %s', r.id)) AS example
        FROM   data_acquisition_run AS r
        WHERE  r.run_status = 'running'
        UNION ALL
        SELECT 'a scoped candidate at another level than its run', count(*),
               min(format('run %s (%s) lists %s (%s)', r.id, r.level, c.id, c.level))
        FROM   data_acquisition_run_candidate AS s
        JOIN   data_acquisition_run AS r ON r.id = s.data_acquisition_run
        JOIN   candidate AS c ON c.id = s.candidate
        WHERE  c.level <> r.level
        UNION ALL
        SELECT 'a scoped attribute at another level than its run', count(*),
               min(format('run %s (%s) lists %s (%s)', r.id, r.level, a.id, a.level))
        FROM   data_acquisition_run_attribute AS s
        JOIN   data_acquisition_run AS r ON r.id = s.data_acquisition_run
        JOIN   attribute AS a ON a.id = s.attribute
        WHERE  a.level <> r.level
        UNION ALL
        SELECT 'an item outside its run''s scope lists', count(*),
               min(format('run %s, %s, %s', i.data_acquisition_run, i.candidate, i.attribute))
        FROM   data_acquisition_run_item AS i
        WHERE  NOT EXISTS (SELECT 1 FROM data_acquisition_run_candidate AS s
                           WHERE  (s.data_acquisition_run, s.candidate)
                                  = (i.data_acquisition_run, i.candidate))
           OR  NOT EXISTS (SELECT 1 FROM data_acquisition_run_attribute AS s
                           WHERE  (s.data_acquisition_run, s.attribute)
                                  = (i.data_acquisition_run, i.attribute))
        UNION ALL
        SELECT 'a value outside its run''s items', count(*),
               min(format('value %s from run %s, %s, %s',
                          v.id, v.data_acquisition_run, v.candidate, v.attribute))
        FROM   value AS v
        WHERE  v.data_acquisition_run IS NOT NULL
          AND  NOT EXISTS (SELECT 1 FROM data_acquisition_run_item AS i
                           WHERE  (i.data_acquisition_run, i.candidate, i.attribute)
                                  = (v.data_acquisition_run, v.candidate, v.attribute))
        UNION ALL
        SELECT 'a failure outside its run''s items', count(*),
               min(format('run %s, %s on %s, %s',
                          f.data_acquisition_run, f.data_source, f.candidate, f.attribute))
        FROM   data_acquisition_failure AS f
        WHERE  NOT EXISTS (SELECT 1 FROM data_acquisition_run_item AS i
                           WHERE  (i.data_acquisition_run, i.candidate, i.attribute)
                                  = (f.data_acquisition_run, f.candidate, f.attribute))
        UNION ALL
        SELECT 'a re-confirmation outside its run''s items', count(*),
               min(format('run %s, %s on %s, %s',
                          u.data_acquisition_run, u.data_source, u.candidate, u.attribute))
        FROM   data_acquisition_run_reuse AS u
        WHERE  NOT EXISTS (SELECT 1 FROM data_acquisition_run_item AS i
                           WHERE  (i.data_acquisition_run, i.candidate, i.attribute)
                                  = (u.data_acquisition_run, u.candidate, u.attribute))
    ) AS offence
    WHERE  how_many > 0;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: a run''s evidence must be one of its items, and its scope must '
            'sit at its level. Found %. Let a running run finish (or restart the backend, which '
            'sweeps it), and record any row outside its run''s items as an item in a repair '
            'migration (D15) -- then migrate again.', offenders;
    END IF;
END $$;

ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_level_key UNIQUE (id, level);

ALTER TABLE data_acquisition_run_candidate ADD COLUMN level text;
ALTER TABLE data_acquisition_run_attribute ADD COLUMN level text;

UPDATE data_acquisition_run_candidate AS s
SET    level = r.level
FROM   data_acquisition_run AS r
WHERE  r.id = s.data_acquisition_run;

UPDATE data_acquisition_run_attribute AS s
SET    level = r.level
FROM   data_acquisition_run AS r
WHERE  r.id = s.data_acquisition_run;

ALTER TABLE data_acquisition_run_candidate
    ALTER COLUMN level SET NOT NULL,
    ADD CONSTRAINT data_acquisition_run_candidate_is_at_its_run_s_level
        FOREIGN KEY (data_acquisition_run, level) REFERENCES data_acquisition_run (id, level),
    ADD CONSTRAINT data_acquisition_run_candidate_sits_at_its_level
        FOREIGN KEY (candidate, level) REFERENCES candidate (id, level);

ALTER TABLE data_acquisition_run_attribute
    ALTER COLUMN level SET NOT NULL,
    ADD CONSTRAINT data_acquisition_run_attribute_is_at_its_run_s_level
        FOREIGN KEY (data_acquisition_run, level) REFERENCES data_acquisition_run (id, level),
    ADD CONSTRAINT data_acquisition_run_attribute_sits_at_its_level
        FOREIGN KEY (attribute, level) REFERENCES attribute (id, level);

ALTER TABLE data_acquisition_run_item
    ADD CONSTRAINT data_acquisition_run_item_candidate_is_in_scope
        FOREIGN KEY (data_acquisition_run, candidate)
        REFERENCES data_acquisition_run_candidate (data_acquisition_run, candidate),
    ADD CONSTRAINT data_acquisition_run_item_attribute_is_in_scope
        FOREIGN KEY (data_acquisition_run, attribute)
        REFERENCES data_acquisition_run_attribute (data_acquisition_run, attribute);

ALTER TABLE value
    ADD CONSTRAINT value_is_one_of_its_run_s_items
        FOREIGN KEY (data_acquisition_run, candidate, attribute)
        REFERENCES data_acquisition_run_item (data_acquisition_run, candidate, attribute)
        MATCH SIMPLE;

ALTER TABLE data_acquisition_failure
    ADD CONSTRAINT data_acquisition_failure_is_one_of_its_run_s_items
        FOREIGN KEY (data_acquisition_run, candidate, attribute)
        REFERENCES data_acquisition_run_item (data_acquisition_run, candidate, attribute);

ALTER TABLE data_acquisition_run_reuse
    ADD CONSTRAINT data_acquisition_run_reuse_is_one_of_its_run_s_items
        FOREIGN KEY (data_acquisition_run, candidate, attribute)
        REFERENCES data_acquisition_run_item (data_acquisition_run, candidate, attribute);

COMMENT ON COLUMN data_acquisition_run_candidate.level IS
    'The run''s level, which the candidate must share (PL-048).';
COMMENT ON COLUMN data_acquisition_run_attribute.level IS
    'The run''s level, which the attribute must share (PL-048).';
