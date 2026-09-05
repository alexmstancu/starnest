-- Allow a candidate at a nested level to belong to nothing again.
--
-- Everything here is derived, so nothing is lost: the flag on the level is computed from
-- parent_level, and the copy on the candidate was read from the level.

ALTER TABLE candidate DROP CONSTRAINT candidate_at_a_nested_level_names_its_parent;
ALTER TABLE candidate DROP CONSTRAINT candidate_knows_whether_its_level_needs_a_parent;
ALTER TABLE candidate DROP COLUMN parent_required;

ALTER TABLE level DROP CONSTRAINT level_parenthood_key;
ALTER TABLE level DROP COLUMN requires_parent;
