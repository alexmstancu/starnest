-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the career and connectivity weights stand exactly
-- as 0463 left them: an edit or a lock since then would be overwritten without anyone choosing to,
-- and the pillar would no longer sum to 100. So this compares them set by set and names every set
-- that moved. A set that no longer exists is passed over, as is every set 0463 never touched
-- (TL-N5).
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
            WHERE  criteria_set IN ('minimal')
              AND  pillar IN ('career', 'connectivity')) AS judged
    FULL JOIN (VALUES
               ('minimal', 'country.average_working_hours', 30),
               ('minimal', 'country.tech_employment_share', 70),
               ('minimal', 'country.broadband_coverage', 50),
               ('minimal', 'country.rail_network_density', 25),
               ('minimal', 'country.road_network_quality', 25)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0463: the career and connectivity weights it set were changed or '
            'locked since in criteria set(s) (%), and this would overwrite them with the weights '
            'before it. Set them back as 0463 left them and roll back again, or restore from the '
            'backup make migrate took.', changed;
    END IF;
END $$;

DELETE FROM criterion
WHERE  criteria_set = 'minimal'
  AND  attribute IN ('country.average_working_hours', 'country.rail_network_density',
                     'country.road_network_quality');
UPDATE criterion SET weight = 100 WHERE criteria_set = 'minimal' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 100 WHERE criteria_set = 'minimal' AND attribute = 'country.broadband_coverage';
