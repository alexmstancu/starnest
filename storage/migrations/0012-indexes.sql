-- The indexes of arch.md 9.3: four queries dominate, and each gets one.
--
-- At the size of arch.md 3.5 none of this is performance-critical. They are here so the shape
-- of the hot path is deliberate rather than discovered.
--
-- Two of the four indexes that section names are not created, because a key already declared
-- serves them and a duplicate index is a cost with no benefit:
--   * `value (candidate)` is a prefix of the active-value index below.
--   * `candidate_attribute_score (candidate_result)` is a prefix of that table's primary key.
-- depends: 0011-active-value-view

-- The ordering the active-value view scans.
CREATE INDEX value_active_lookup
    ON value (candidate, attribute, breakdown_option, retrieval_date DESC);

-- What a run produced, and what it failed on.
CREATE INDEX value_by_run
    ON value (data_acquisition_run);
CREATE INDEX data_acquisition_failure_by_run
    ON data_acquisition_failure (data_acquisition_run);
