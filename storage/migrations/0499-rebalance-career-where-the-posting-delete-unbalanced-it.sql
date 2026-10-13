-- Repair any criteria set 0487 left with an unbalanced `career` pillar (ST-03).
--
-- `0487` deleted the two retired posting criteria (`tech_software_jobs`, `tech_product_jobs`)
-- from EVERY set, but moved their weight onto `tech_employment_share` only in `local_employment`
-- and `remote_only`. A set duplicated before `0487` -- or any other that held the posting
-- criteria -- therefore lost their points from the career pillar, which then no longer sums to
-- 100; the domain refuses a pillar that does not sum to 100 (`reqs.md` Q82), so the whole set
-- becomes unloadable. The unscoped `DELETE` and the scoped `UPDATE` were the mismatch.
--
-- This restores the shortfall to `tech_employment_share`, exactly as `0487` did for the shipped
-- sets, for any set whose career pillar still falls short. The shipped sets already sum to 100,
-- so it is a no-op for them and for a freshly-seeded database: it heals only a set the earlier
-- unscoped delete actually damaged, and only one that still carries `tech_employment_share` to
-- carry the weight back.
-- depends: 0498-one-acquisition-run-at-a-time
UPDATE criterion AS c
SET    weight = c.weight + short.missing
FROM (
    SELECT criteria_set, 100 - SUM(weight) AS missing
    FROM   criterion
    WHERE  pillar = 'career'
    GROUP  BY criteria_set
    HAVING SUM(weight) <> 100
) AS short
WHERE  c.criteria_set = short.criteria_set
  AND  c.pillar = 'career'
  AND  c.attribute = 'country.tech_employment_share';
