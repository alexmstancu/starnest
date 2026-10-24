-- Drops the 1-20 ceiling and nothing else: 0008's `>= 1` stays, and no stored figure moves.
-- The API still refuses 21 until its own bound is reverted with the code.

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_comparator_limit_is_one_to_twenty;
