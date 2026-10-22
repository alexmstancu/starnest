-- A run records the exact (candidate, attribute) pairs it asked about (BE-11).
--
-- depends: 0505-a-warnings-inputs-die-with-the-warning
--
-- A run's scope was two lists -- the candidates and the attributes -- so its item count was
-- their product, a rectangle. For a sweep that is right: every candidate is asked about every
-- attribute. For a *retry* it is not: a retry asks each source only about the pairs it failed
-- on, so the rectangle spanning those pairs names corners no source is asked about, and the run
-- then reported them `unanswered` for ever -- items nobody asked about, that asking again could
-- never close (BE-11).
--
-- This records the pairs themselves. It is the uniform truth for a run's items: a sweep writes
-- the full rectangle (one INSERT ... SELECT cross join), a retry writes only its real pairs. The
-- two list tables stay -- they still answer "which candidates / which attributes did this run
-- cover" for the screen -- but the counts now read from here.

CREATE TABLE data_acquisition_run_item (
    data_acquisition_run bigint NOT NULL REFERENCES data_acquisition_run (id),
    candidate            text   NOT NULL REFERENCES candidate (id),
    attribute            text   NOT NULL REFERENCES attribute (id),

    CONSTRAINT data_acquisition_run_item_pkey
        PRIMARY KEY (data_acquisition_run, candidate, attribute)
);

-- Backfill every run that already exists as the rectangle it was accounted as, so no historical
-- run's item counts move: its pairs are exactly its candidate list crossed with its attribute
-- list, which is what the counts read before this table existed.
INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute)
SELECT c.data_acquisition_run, c.candidate, a.attribute
FROM   data_acquisition_run_candidate AS c
JOIN   data_acquisition_run_attribute AS a
       ON a.data_acquisition_run = c.data_acquisition_run;
