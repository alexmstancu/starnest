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

-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the career weights stand exactly as 0477 left
-- them: an edit or a lock since then would be overwritten without anyone choosing to, and the
-- pillar would no longer sum to 100. So this compares them set by set and names every set that
-- moved. A set that no longer exists is passed over, as is every set 0477 never touched (TL-N5).
--
-- **Locked before it compares** (BE-A1): an edit committed between the comparison and the overwrite
-- would escape it. SHARE ROW EXCLUSIVE waits for a write in flight and holds off new ones until
-- this commits, while reads go on.
LOCK TABLE criterion IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    changed text;
BEGIN
    SELECT string_agg(DISTINCT coalesce(judged.criteria_set, left_by.criteria_set), ', '
                      ORDER BY coalesce(judged.criteria_set, left_by.criteria_set))
    INTO   changed
    FROM   (SELECT criteria_set, attribute, weight, weight_locked
            FROM   criterion
            WHERE  criteria_set IN ('local_employment', 'remote_only')
              AND  pillar IN ('career')) AS judged
    FULL JOIN (VALUES
               ('local_employment', 'country.average_working_hours', 16.67),
               ('local_employment', 'country.international_employers', 20.00),
               ('local_employment', 'country.tech_employment_share', 14.44),
               ('local_employment', 'country.tech_product_jobs', 24.45),
               ('local_employment', 'country.tech_software_jobs', 24.44),
               ('remote_only', 'country.average_working_hours', 5.26),
               ('remote_only', 'country.international_employers', 42.11),
               ('remote_only', 'country.tech_employment_share', 21.05),
               ('remote_only', 'country.tech_product_jobs', 15.79),
               ('remote_only', 'country.tech_software_jobs', 15.79)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0477: the career weights it set were changed or locked since in '
            'criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0477 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

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
