-- Narrow the key back to the start of the period.
--
-- This can FAIL, and failing is correct: if an annual and a sub-annual score for the same
-- start date have both been stored since 0113, they are two rows the old key cannot tell
-- apart, and there is no honest way to choose one.

ALTER TABLE external_score DROP CONSTRAINT external_score_natural_key;

ALTER TABLE external_score
    ADD CONSTRAINT external_score_natural_key
        UNIQUE (candidate, data_source, reference_period_start, retrieval_date);
