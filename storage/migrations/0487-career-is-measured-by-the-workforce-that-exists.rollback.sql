-- Back to two unanswerable posting counts carrying 6.84 points between them.
--
-- **`value_type` and `weight_locked` are stated.** Both are `NOT NULL` with no default on
-- `criterion`, so an insert that omits them aborts -- which this rollback did until it was read
-- rather than assumed. A rollback nobody has run is a rollback nobody knows about.

-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the career weights stand exactly as 0487 left
-- them: an edit or a lock since then would be overwritten without anyone choosing to, and the
-- pillar would no longer sum to 100. So this compares them set by set and names every set that
-- moved. A set that no longer exists is passed over, as is every set 0487 never touched (TL-N5).
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
               ('local_employment', 'country.tech_employment_share', 63.33),
               ('remote_only', 'country.average_working_hours', 5.26),
               ('remote_only', 'country.international_employers', 42.11),
               ('remote_only', 'country.tech_employment_share', 52.63)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0487: the career weights it set were changed or locked since in '
            'criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0487 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

UPDATE attribute SET lifecycle_status = 'active'
WHERE  id IN ('country.tech_software_jobs', 'country.tech_product_jobs');

-- Only into a set that still exists (TL-N5): a shipped set can be deleted.
INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
SELECT declared.criteria_set, declared.attribute, 'Count', 'career', declared.weight,
       'maximise', 'fixed', true, false, false
FROM   (VALUES
    ('local_employment', 'country.tech_software_jobs', 24.44),
    ('local_employment', 'country.tech_product_jobs',  24.45),
    ('remote_only',      'country.tech_software_jobs', 15.79),
    ('remote_only',      'country.tech_product_jobs',  15.79)
) AS declared (criteria_set, attribute, weight)
JOIN   criteria_set AS kept ON kept.id = declared.criteria_set;

-- The weight returns to what it was before the two were folded in, so career sums to 100 again.
UPDATE criterion SET weight = 14.44
WHERE  criteria_set = 'local_employment' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 21.05
WHERE  criteria_set = 'remote_only' AND attribute = 'country.tech_employment_share';
