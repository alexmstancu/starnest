-- Back to a scored criterion at the weights it shipped with.

-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the career weights stand exactly as 0476 left
-- them: an edit or a lock since then would be overwritten without anyone choosing to, and the
-- pillar would no longer sum to 100. So this compares them set by set and names every set that
-- moved. A set that no longer exists is passed over, as is every set 0476 never touched (TL-N5).
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
               ('local_employment', 'country.average_working_hours', 16.6666666666666667),
               ('local_employment', 'country.international_employers', 20.0000000000000000),
               ('local_employment', 'country.tech_employment_share', 14.4444444444444444),
               ('local_employment', 'country.tech_product_jobs', 24.4444444444444444),
               ('local_employment', 'country.tech_software_jobs', 24.4444444444444444),
               ('remote_only', 'country.average_working_hours', 5.2631578947368421),
               ('remote_only', 'country.international_employers', 42.1052631578947368),
               ('remote_only', 'country.tech_employment_share', 21.0526315789473684),
               ('remote_only', 'country.tech_product_jobs', 15.7894736842105263),
               ('remote_only', 'country.tech_software_jobs', 15.7894736842105263)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0476: the career weights it set were changed or locked since in '
            'criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0476 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, blocks_if_missing)
SELECT declared.criteria_set, 'country.statutory_paid_leave', 'career', 'Quantity', true,
       declared.weight, false, 'maximise', 'fixed', false
FROM   (VALUES ('local_employment', 10), ('remote_only', 5)) AS declared (criteria_set, weight)
-- Only into a set that still exists (TL-N5): a shipped set can be deleted.
JOIN   criteria_set AS kept ON kept.id = declared.criteria_set;

-- **Only the two sets that had it.** An earlier draft scaled every career criterion, including
-- `minimal`'s, where the subquery found nothing and wrote NULL into a NOT NULL column.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 'country.tech_product_jobs',       22),
    ('local_employment', 'country.tech_software_jobs',      22),
    ('local_employment', 'country.international_employers', 18),
    ('local_employment', 'country.average_working_hours',   15),
    ('local_employment', 'country.tech_employment_share',   13),
    ('remote_only',      'country.international_employers', 40),
    ('remote_only',      'country.tech_employment_share',   20),
    ('remote_only',      'country.tech_product_jobs',       15),
    ('remote_only',      'country.tech_software_jobs',      15),
    ('remote_only',      'country.average_working_hours',    5)
) AS declared (criteria_set, attribute, weight)
WHERE  criterion.criteria_set = declared.criteria_set
  AND  criterion.attribute = declared.attribute;
