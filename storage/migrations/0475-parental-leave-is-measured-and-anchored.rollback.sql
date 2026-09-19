-- Back to an unanchored criterion measuring raw weeks, which is how it shipped.

DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.parental_leave_policy');

UPDATE attribute
SET    description = 'weeks paid'
WHERE  id = 'country.parental_leave_policy';
