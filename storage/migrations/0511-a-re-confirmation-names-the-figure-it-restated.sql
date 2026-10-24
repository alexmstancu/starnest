-- A re-confirmation names the stored figure it restated (PL-049: UF-073; C04-N5).
--
-- depends: 0510-a-gate-answer-is-kept-once-written
--
-- A run that re-reads a transcribed table stores no new row, so `data_acquisition_run_reuse`
-- (0501) is the only record of what it produced -- and it named the pair, not the figure. The
-- acquisition diff could then only call the pair "went missing", or guess "unchanged", which is
-- wrong whenever the earlier run produced an older transcription than the one re-confirmed. The
-- run now writes the id of the row its re-read restated (NEW-23's natural-key read finds it).
--
-- **An outgoing key with no cascade**: a value is never deleted with a run, nor a reuse row with
-- a value. NULL where the figure is not known: a pair re-confirmed through two stored rows (two
-- breakdown options), and history this backfill cannot settle.
--
-- **The backfill names a row only where exactly one could have been restated**: one row from the
-- reuse's source for its pair, retrieved no later than the run started. Where two qualify, the
-- latest is not necessarily the one re-read -- a run may restate an older transcription than the
-- newest on record -- and a wrong id reads "unchanged" where NULL reads "refreshed", so NULL.

-- **Locked first** (BE-A1): a figure stored, or a reuse recorded, between the count and the
-- update would make a pair that is no longer unambiguous look as if it were.
LOCK TABLE data_acquisition_run_reuse, value IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE data_acquisition_run_reuse ADD COLUMN value bigint;
ALTER TABLE data_acquisition_run_reuse
    ADD CONSTRAINT data_acquisition_run_reuse_names_a_stored_figure
    FOREIGN KEY (value) REFERENCES value (id);

UPDATE data_acquisition_run_reuse AS reuse
SET    value = sole.id
FROM   (SELECT candidate_row.data_acquisition_run,
               candidate_row.data_source,
               candidate_row.candidate,
               candidate_row.attribute,
               min(candidate_row.id) AS id
        FROM   (SELECT r.data_acquisition_run, r.data_source, r.candidate, r.attribute, v.id
                FROM   data_acquisition_run_reuse AS r
                JOIN   data_acquisition_run AS run ON run.id = r.data_acquisition_run
                JOIN   value AS v
                       ON  v.data_source = r.data_source
                       AND v.candidate = r.candidate
                       AND v.attribute = r.attribute
                       AND v.retrieval_date <= run.started_at) AS candidate_row
        GROUP  BY candidate_row.data_acquisition_run, candidate_row.data_source,
                  candidate_row.candidate, candidate_row.attribute
        HAVING count(*) = 1) AS sole
WHERE  sole.data_acquisition_run = reuse.data_acquisition_run
  AND  sole.data_source = reuse.data_source
  AND  sole.candidate = reuse.candidate
  AND  sole.attribute = reuse.attribute;

COMMENT ON COLUMN data_acquisition_run_reuse.value IS
    'The stored value the re-read restated. Null where it is not known: re-confirmed through two rows, or recorded before 0511 with more than one row it could have restated (C04-N5).';
