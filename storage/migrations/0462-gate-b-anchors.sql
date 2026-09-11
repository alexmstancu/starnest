-- Anchors for the seven `fixed` criteria of the shipped set whose data has landed: Gate B's
-- derivation (devplan.md), chosen by the household on 2026-09-11 against the real figures (Q209).
--
-- The same three steps as the tax rate (0447): the observed range across the 32, anchor pairs
-- proposed from it with their effect on real countries, the household's choice seeded here.
-- Every proposal came with a stricter or gentler alternative and percentile; each time the
-- household took the first. Linear between the two anchors, clamped beyond them.
--
-- | Criterion | Anchors | What the real figures do |
-- |---|---|---|
-- | housing_cost_overburden_rate | 5% -> 100, 20% -> 0 | Romania 100, Germany 59; the best quarter ties at 100, Denmark and Greece at 0 |
-- | tech_employment_share | 3% -> 0, 7% -> 100 | Romania 0 and Greece 0 nationally; Germany 62; NL, FI, LU, SE 100 |
-- | broadband_coverage | 80% -> 0, 100% -> 100 | Spreads a bunched column: Romania 84, Germany 74, Latvia 0 |
-- | life_satisfaction | 6 -> 0, 8 -> 100 | Romania 90, Germany 50, Bulgaria 15, Iceland 100 |
-- | economic_outlook | 0% -> 0, 3% -> 100 | Romania 83, Germany 40; Cyprus and Malta 100 |
-- | overcrowding_rate | 5% -> 100, 30% -> 0 | Romania 0 (40.4%, Europe's highest), Germany 73 |
-- | protected_land_share | 10% -> 0, 40% -> 100 | Romania 45, Germany 97, Finland 11 |
--
-- Caveats the household saw and accepted: Romania's tech share is national, and Bucharest and
-- Cluj are city-level questions; one year's growth forecast is noisy and partly catching up; a
-- protected designation is not the same as nature one can reach, so Finland scores low.
--
-- Scores on a scale of 100, the shipped `settings.score_scale_max`, as in 0447. Provisional, like
-- every threshold in this project.
-- depends: 0461-a-failure-names-its-source

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, anchor.input_value, anchor.score
FROM   criterion AS c
JOIN   (VALUES
            ('country.housing_cost_overburden_rate', 5,   100),
            ('country.housing_cost_overburden_rate', 20,  0),
            ('country.tech_employment_share',        3,   0),
            ('country.tech_employment_share',        7,   100),
            ('country.broadband_coverage',           80,  0),
            ('country.broadband_coverage',           100, 100),
            ('country.life_satisfaction',            6,   0),
            ('country.life_satisfaction',            8,   100),
            ('country.economic_outlook',             0,   0),
            ('country.economic_outlook',             3,   100),
            ('country.overcrowding_rate',            5,   100),
            ('country.overcrowding_rate',            30,  0),
            ('country.protected_land_share',         10,  0),
            ('country.protected_land_share',         40,  100)
        ) AS anchor (attribute, input_value, score)
       ON anchor.attribute = c.attribute
WHERE  c.criteria_set = 'local_employment'
ON CONFLICT (criterion, input_value) DO UPDATE SET score = EXCLUDED.score;
