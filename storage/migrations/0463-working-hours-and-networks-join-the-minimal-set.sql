-- W4-F's last three join `minimal`, as every stream's attributes have (0410-0414), so their
-- figures are scored rather than merely stored: usual full-time working hours (Eurostat, the
-- attribute's declared second source below OECD) in career, and railway and motorway density in
-- connectivity. Pillar weights are unchanged; the new criteria share their pillar's 100 with
-- what was there. Percentile throughout, as the rest of `minimal` is -- it is the set that
-- proves figures reach a score, not a judgement about what matters.
-- depends: 0462-gate-b-anchors

UPDATE criterion SET weight = 70 WHERE criteria_set = 'minimal' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 50 WHERE criteria_set = 'minimal' AND attribute = 'country.broadband_coverage';

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, declared.weight, declared.goal,
       'percentile', false
FROM   (VALUES
    ('country.average_working_hours', 30, 'minimise'),
    ('country.rail_network_density',  25, 'maximise'),
    ('country.road_network_quality',  25, 'maximise')
) AS declared (attribute, weight, goal)
JOIN   attribute AS a ON a.id = declared.attribute
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
