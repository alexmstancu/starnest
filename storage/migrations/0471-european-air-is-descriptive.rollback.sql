-- Score European air connectivity again, splitting the air weight as `0470` did.
--
-- The criterion is rebuilt rather than restored: nothing kept a copy of it, because a criterion
-- is the household's opinion and this migration recorded a change of it.

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal,
    normalisation_method, blocks_if_missing)
SELECT declared.criteria_set, 'country.european_air_connectivity', 'connectivity', 'Count',
       true, declared.weight, 'maximise', 'fixed', false
FROM   (VALUES
    ('local_employment', 13),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
ON CONFLICT DO NOTHING;

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 12),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
WHERE  criterion.attribute = 'country.international_air_connectivity'
  AND  criterion.criteria_set = declared.criteria_set;
