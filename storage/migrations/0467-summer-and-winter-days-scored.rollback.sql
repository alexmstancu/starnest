-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the climate weights stand exactly as 0467 left
-- them: an edit or a lock since then would be overwritten without anyone choosing to, and the
-- pillar would no longer sum to 100. So this compares them set by set and names every set that
-- moved. A set that no longer exists is passed over, as is every set 0467 never touched (TL-N5).
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
            WHERE  criteria_set IN ('local_employment')
              AND  pillar IN ('climate')) AS judged
    FULL JOIN (VALUES
               ('local_employment', 'country.annual_sunshine_hours', 15),
               ('local_employment', 'country.avg_annual_temperature', 20),
               ('local_employment', 'country.climate_zone', 15),
               ('local_employment', 'country.projected_summer_heat_days', 10),
               ('local_employment', 'country.summer_daytime_temperature', 20),
               ('local_employment', 'country.winter_daytime_temperature', 20)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0467: the climate weights it set were changed or locked since in '
            'criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0467 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

-- **Refuses while another set judges the two daytime temperatures** (TL-N5). This removes them
-- from `local_employment` only, and `0466`'s rollback then deletes the attributes: a duplicated
-- set that still judges them would stop that on a foreign key, and removing them here would
-- leave its climate pillar short of 100 behind a person's back.
DO $$
DECLARE
    others text;
BEGIN
    SELECT string_agg(DISTINCT criteria_set, ', ' ORDER BY criteria_set)
    INTO   others
    FROM   criterion
    WHERE  criteria_set <> 'local_employment'
      AND  attribute IN ('country.summer_daytime_temperature',
                         'country.winter_daytime_temperature');
    IF others IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0467: criteria set(s) (%) also judge the summer and winter daytime '
            'temperatures, which this unscores. Remove those criteria from them (Configure, '
            'Criteria) and roll back again, or restore from the backup make migrate took.',
            others;
    END IF;
END $$;

DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE criteria_set = 'local_employment'
                     AND attribute = 'country.winter_daytime_temperature');
DELETE FROM criterion
WHERE  criteria_set = 'local_employment'
  AND  attribute IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
UPDATE criterion SET weight = 25 WHERE criteria_set = 'local_employment' AND attribute = 'country.avg_annual_temperature';
UPDATE criterion SET weight = 25 WHERE criteria_set = 'local_employment' AND attribute = 'country.annual_sunshine_hours';
UPDATE criterion SET weight = 20 WHERE criteria_set = 'local_employment' AND attribute = 'country.projected_summer_heat_days';
UPDATE criterion SET weight = 30 WHERE criteria_set = 'local_employment' AND attribute = 'country.climate_zone';
