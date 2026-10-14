-- Drop the three frozen columns, returning the snapshot to reading `value_type` live and
-- dropping lock and threshold on read. Touches `evaluation_criterion`, the table the forward
-- step altered.

ALTER TABLE evaluation_criterion
    DROP CONSTRAINT IF EXISTS evaluation_criterion_value_type_is_known;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS value_type;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS weight_locked;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS matching_threshold;
