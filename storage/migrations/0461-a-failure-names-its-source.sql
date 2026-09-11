-- A failure says which source failed. Found building Gate B's selective retry, 2026-09-11.
--
-- **Why it was missing.** Until 711ad9d a run through the API asked one source, so "which
-- source failed?" had one answer and no column. A run now asks all six, and two of them answer
-- the total tax rate: with no source on the row, the second failure for one item overwrote the
-- first's message, and a retry could not know whom to ask again.
--
-- **The backfill is a fact, not a default.** Every failure stored before this migration came
-- from a run started through the API, and every such run asked Eurostat alone -- that was the
-- defect 711ad9d fixed (known-issues.md P5). `make acquire` records no run and so no failure.
-- depends: 0460-a-neighbour-stands-in-visibly

ALTER TABLE data_acquisition_failure
    ADD COLUMN data_source text REFERENCES data_source (id);

UPDATE data_acquisition_failure SET data_source = 'eurostat';

ALTER TABLE data_acquisition_failure ALTER COLUMN data_source SET NOT NULL;

-- One failure per source per item per run: the unit a retry addresses is now a source asked
-- about one candidate's attribute, because asking OECD again is a different act from asking the
-- estimate again.
ALTER TABLE data_acquisition_failure DROP CONSTRAINT data_acquisition_failure_pkey;
ALTER TABLE data_acquisition_failure ADD CONSTRAINT data_acquisition_failure_pkey
    PRIMARY KEY (data_acquisition_run, data_source, candidate, attribute);
