-- Record the figures a run re-confirmed but did not need to store again (ST-09).
--
-- depends: 0500-freeze-value-type-lock-and-threshold-in-the-evaluation-snapshot
--
-- A transcribed table is stamped with the day it was transcribed, not the day a run copies it
-- (`published_tables`), so re-reading it is the SAME observation: the append is an
-- `ON CONFLICT DO NOTHING` no-op and no new value row carries the later run. The run's accounting
-- then counts the item `unanswered` -- a pair with no value and no failure for this run -- and
-- offers to ask again, though the source did answer and the figure is on record.
--
-- This table records that the source answered the pair for this run even though nothing new was
-- stored. The accounting reads it so a re-confirmed pair counts as completed, not unanswered. It
-- mirrors `data_acquisition_failure`: the same three-column key, keyed to the run, so a run's
-- reuses go when the run does and a pair is recorded at most once per run.

CREATE TABLE data_acquisition_run_reuse (
    data_acquisition_run bigint NOT NULL REFERENCES data_acquisition_run (id),
    candidate            text   NOT NULL REFERENCES candidate (id),
    attribute            text   NOT NULL REFERENCES attribute (id),

    CONSTRAINT data_acquisition_run_reuse_pkey
        PRIMARY KEY (data_acquisition_run, candidate, attribute)
);
