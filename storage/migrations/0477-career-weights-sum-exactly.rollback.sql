-- Back to the divided weights of 0476, which do not sum to exactly 100.
UPDATE criterion
SET    weight = weight * 100 / (
           SELECT SUM(s.weight) FROM criterion AS s
           WHERE s.criteria_set = criterion.criteria_set AND s.pillar = 'career')
WHERE  criterion.pillar = 'career'
  AND  criterion.criteria_set IN ('local_employment', 'remote_only');
