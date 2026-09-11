-- The two seasonal temperatures join the shipped set, scored as the household chose against the
-- real figures on 2026-09-11 (Q213).
--
-- | Criterion | Scoring | What the real figures do |
-- |---|---|---|
-- | summer_daytime_temperature | comfortable 20-26 °C, 0 at 12 and at 36 | Sweden and Germany 100, Romania (29.7) 63, Spain 32, Cyprus 6 |
-- | winter_daytime_temperature | warmer is better, 0 °C -> 0, 15 °C -> 100 | Sweden 19, Romania (5.7) 38, France 64, Cyprus 100 |
--
-- **The climate pillar re-divides so the three temperatures weigh the same**: the yearly average,
-- a summer day and a winter day at 20 each; sunshine 15 and summer heat days 10, both still
-- without data; the climate zone 15, never scored. The yearly average keeps the household's
-- 18-26 °C band (Q213), which favours the south where the summer band penalises it -- a mild
-- climate without scorching summers.
-- depends: 0466-summer-and-winter-days

UPDATE criterion SET weight = 20 WHERE criteria_set = 'local_employment' AND attribute = 'country.avg_annual_temperature';
UPDATE criterion SET weight = 15 WHERE criteria_set = 'local_employment' AND attribute = 'country.annual_sunshine_hours';
UPDATE criterion SET weight = 10 WHERE criteria_set = 'local_employment' AND attribute = 'country.projected_summer_heat_days';
UPDATE criterion SET weight = 15 WHERE criteria_set = 'local_employment' AND attribute = 'country.climate_zone';

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal,
    target_range_min, target_range_max, zero_score_below, zero_score_above,
    normalisation_method, blocks_if_missing)
SELECT 'local_employment', a.id, a.pillar, a.value_type, true, 20, declared.goal,
       declared.target_range_min, declared.target_range_max,
       declared.zero_score_below, declared.zero_score_above, 'fixed', false
FROM   (VALUES
    ('country.summer_daytime_temperature', 'target_range', 20::numeric, 26::numeric, 12::numeric, 36::numeric),
    ('country.winter_daytime_temperature', 'maximise',     NULL,        NULL,        NULL,        NULL)
) AS declared (attribute, goal, target_range_min, target_range_max, zero_score_below, zero_score_above)
JOIN   attribute AS a ON a.id = declared.attribute
ON CONFLICT (criteria_set, attribute) DO NOTHING;

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, anchor.input_value, anchor.score
FROM   criterion AS c
CROSS  JOIN (VALUES (0, 0), (15, 100)) AS anchor (input_value, score)
WHERE  c.criteria_set = 'local_employment'
  AND  c.attribute = 'country.winter_daytime_temperature'
ON CONFLICT (criterion, input_value) DO UPDATE SET score = EXCLUDED.score;
