-- Undo 0520: a criterion may again carry several share bounds and several label thresholds.
--
-- Loosens and loses nothing -- no row is written or removed -- so it never refuses. Locked first
-- for the same reason 0520 is.

LOCK TABLE criterion_threshold_share, criterion_threshold_label IN ACCESS EXCLUSIVE MODE;

ALTER TABLE criterion_threshold_share
    DROP CONSTRAINT IF EXISTS criterion_threshold_share_one_per_criterion;

ALTER TABLE criterion_threshold_label
    DROP CONSTRAINT IF EXISTS criterion_threshold_label_one_per_criterion;
