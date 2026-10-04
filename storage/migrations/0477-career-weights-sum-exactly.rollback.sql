-- Back to the divided weights of 0476, which do not sum to exactly 100.
--
-- **The previous version of this file restored nothing.** It renormalised the weights it found
-- -- `weight * 100 / SUM(weight)` over the career pillar -- and the forward migration had
-- already made that sum exactly 100, so every row was multiplied by 1 and kept the declared
-- two-decimal figure. It ran cleanly, it touched the right table, and the catalog afterwards
-- was the one the migration had written rather than the one before it: 16.67 where 0476 left
-- 16.6666666666666667.
--
-- So the division is re-stated rather than recomputed. These are 0476's own proportions --
-- 22/22/18/15/13 of 90 and 40/20/15/15/5 of 95 -- and `share * 100 / total` in `numeric`
-- reproduces its sixteen decimal places exactly, which no rounded literal can.
--
-- **WARNING: this deliberately restores a catalog the application refuses to read.** That is
-- the point of 0476 being a separate step, and it is why the forward migration exists: the
-- sums come to 99.9999999999999999, and `CriteriaSet` compares against 100 exactly, so the set
-- will not load until 0476 is rolled back in its turn. Anyone stopping here has rolled back
-- half of a two-part repair.

UPDATE criterion
SET    weight = declared.share::numeric * 100 / declared.total
FROM   (VALUES
    -- local_employment: 22/22/18/15/13 of 90, as 0476 divided them.
    ('local_employment', 'country.tech_product_jobs',       22, 90),
    ('local_employment', 'country.tech_software_jobs',      22, 90),
    ('local_employment', 'country.international_employers', 18, 90),
    ('local_employment', 'country.average_working_hours',   15, 90),
    ('local_employment', 'country.tech_employment_share',   13, 90),
    -- remote_only: 40/20/15/15/5 of 95.
    ('remote_only',      'country.international_employers', 40, 95),
    ('remote_only',      'country.tech_employment_share',   20, 95),
    ('remote_only',      'country.tech_product_jobs',       15, 95),
    ('remote_only',      'country.tech_software_jobs',      15, 95),
    ('remote_only',      'country.average_working_hours',    5, 95)
) AS declared (criteria_set, attribute, share, total)
WHERE  criterion.criteria_set = declared.criteria_set
  AND  criterion.attribute = declared.attribute;
