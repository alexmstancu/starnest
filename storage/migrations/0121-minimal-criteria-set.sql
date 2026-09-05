-- A criteria set that can actually produce a score today.
--
-- The shipped `local_employment` set cannot, and not by oversight: 26 of its 41 criteria
-- normalise `fixed` and **no scale anchor ships**, because the anchors are the user's to set
-- against real figures and inventing them is what devplan.md 0.3 forbids. A fixed scale with no
-- anchors maps nothing, so every candidate would come back insufficient_data forever.
--
-- This set uses `percentile`, which needs no configuration at all: a candidate's score is its
-- standing among the candidates being ranked, so real values alone are enough. That is
-- reqs.md 5.1's third method doing exactly what it is for, and it means the first ranking this
-- application ever produces contains no invented number anywhere (docs/mine2e.md 0).
--
-- Three criteria, because three attributes have real figures: the Eurostat indicators the
-- adapter fetches. A criterion over an attribute nobody has fetched would be a criterion that
-- only ever redistributes its weight away.
--
-- **It does not replace the shipped set and does not touch it.** `local_employment` stays
-- exactly as seeded, and becomes scoreable the day its anchors are chosen.
--
-- The goals are the obvious readings and are the user's to change: housing cost overburden and
-- overcrowding are costs, life satisfaction is not.
-- depends: 0120-country-codes

INSERT INTO criteria_set (id, name) VALUES
    ('minimal', 'Minimal (percentile)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Two pillars, because the three attributes live in two. Weights sum to 100 within the level.
INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'housing', 'country', 60),
    ('minimal', 'culture', 'country', 40)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

-- Criterion weights sum to 100 WITHIN a pillar: the two housing criteria split it, and the one
-- culture criterion takes all of its own.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, declared.weight, declared.goal,
       'percentile', false
FROM   (VALUES
    ('country.housing_cost_overburden_rate', 50, 'minimise'),
    ('country.overcrowding_rate',            50, 'minimise'),
    ('country.life_satisfaction',           100, 'maximise')
) AS declared (attribute, weight, goal)
JOIN   attribute AS a ON a.id = declared.attribute
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
