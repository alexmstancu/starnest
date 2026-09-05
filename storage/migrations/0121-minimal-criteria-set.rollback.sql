-- Remove the minimal set. Nothing else references it: it holds no evaluation, because an
-- evaluation is written only when deliberately kept (reqs.md Q155).

DELETE FROM criterion     WHERE criteria_set = 'minimal';
DELETE FROM pillar_weight WHERE criteria_set = 'minimal';
DELETE FROM criteria_set  WHERE id = 'minimal';
