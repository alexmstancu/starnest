-- Remove the remote-only set. Nothing measured goes with it: the set holds no values, only
-- weights over attributes that stay exactly as they are.
--
-- The anchors go first, because they hang off the criteria being deleted. An evaluation would
-- not: one is written only when deliberately kept (reqs.md Q155), and it freezes its own copy
-- of every criterion it used (reqs.md 3.4a) rather than pointing at the live set.

DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE criteria_set = 'remote_only');

DELETE FROM criterion     WHERE criteria_set = 'remote_only';
DELETE FROM pillar_weight WHERE criteria_set = 'remote_only';
DELETE FROM criteria_set  WHERE id = 'remote_only';
