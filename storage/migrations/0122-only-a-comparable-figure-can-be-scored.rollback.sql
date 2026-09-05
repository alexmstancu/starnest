-- Allow a criterion to ask for a score its attribute cannot produce again.
--
-- The three corrected rows are NOT restored to is_scored = true. They were wrong: their weight
-- could never become a contribution, and putting them back would reinstate 68 weight-points
-- that redistribute away on every candidate while coverage calls it missing data.

ALTER TABLE criterion DROP CONSTRAINT criterion_scores_only_a_comparable_figure;
