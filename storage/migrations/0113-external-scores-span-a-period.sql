-- An outside opinion is identified by the period it covers, both ends of it.
--
-- `external_score_natural_key` was (candidate, data_source, reference_period_start,
-- retrieval_date) -- the START of the period and not the end. So one publisher's ANNUAL figure
-- for 2026 and its MONTHLY figure for January 2026 share a start date, and the second one
-- silently collides with the first (known-issues D10).
--
-- This is the argument `value_natural_key` already makes one table over, and it is the same
-- argument reqs.md 3.6 makes for keeping two dates: a period is a span, and half a span does
-- not identify it. The published composite scores this table holds are exactly where annual
-- and sub-annual editions of one indicator coexist.
--
-- Widening a unique key can never conflict with rows already stored: every pair that was
-- distinct before is still distinct with a column added.
-- depends: 0112-a-conversion-names-a-published-rate

ALTER TABLE external_score DROP CONSTRAINT external_score_natural_key;

ALTER TABLE external_score
    ADD CONSTRAINT external_score_natural_key
        UNIQUE (candidate, data_source, reference_period_start, reference_period_end,
                retrieval_date);
