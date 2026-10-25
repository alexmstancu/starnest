-- Score European air connectivity again, splitting the air weight as `0470` did.
--
-- The criterion is rebuilt rather than restored: nothing kept a copy of it, because a criterion
-- is the household's opinion and this migration recorded a change of it.

-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the connectivity weights stand exactly as 0471
-- left them: an edit or a lock since then would be overwritten without anyone choosing to, and the
-- pillar would no longer sum to 100. So this compares them set by set and names every set that
-- moved. A set that no longer exists is passed over, as is every set 0471 never touched (TL-N5).
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
              AND  pillar IN ('connectivity')) AS judged
    FULL JOIN (VALUES
               ('local_employment', 'country.broadband_coverage', 25),
               ('local_employment', 'country.international_air_connectivity', 25),
               ('local_employment', 'country.rail_network_density', 30),
               ('local_employment', 'country.road_network_quality', 20),
               ('remote_only', 'country.broadband_coverage', 40),
               ('remote_only', 'country.international_air_connectivity', 30),
               ('remote_only', 'country.rail_network_density', 20),
               ('remote_only', 'country.road_network_quality', 10)
           ) AS left_by (criteria_set, attribute, weight)
           ON  left_by.criteria_set = judged.criteria_set
           AND left_by.attribute = judged.attribute
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM criterion AS kept
                   WHERE kept.criteria_set = coalesce(judged.criteria_set, left_by.criteria_set));
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0471: the connectivity weights it set were changed or locked since '
            'in criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0471 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal,
    normalisation_method, blocks_if_missing)
SELECT declared.criteria_set, 'country.european_air_connectivity', 'connectivity', 'Count',
       true, declared.weight, 'maximise', 'fixed', false
FROM   (VALUES
    ('local_employment', 13),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
-- Only into a set that still exists (TL-N5): a shipped set can be deleted.
JOIN   criteria_set AS kept ON kept.id = declared.criteria_set
ON CONFLICT DO NOTHING;

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 12),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
WHERE  criterion.attribute = 'country.international_air_connectivity'
  AND  criterion.criteria_set = declared.criteria_set;
