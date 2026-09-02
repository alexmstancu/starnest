-- Drop the band labels.

ALTER TABLE evaluation_scale_anchor DROP COLUMN label;
ALTER TABLE criterion_scale_anchor DROP COLUMN label;
