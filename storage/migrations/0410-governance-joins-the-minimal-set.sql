-- The World Bank's three governance figures become something that scores.
--
-- `0121` created `minimal` with three criteria and said why: "three attributes have real
-- figures". Six do now, and a criterion over an attribute nobody has fetched is the only thing
-- that comment was guarding against. Leaving the set at three would mean the ranking still
-- rests on two pillars while four have data -- which is the exact problem devplan.md 0.0
-- finding 3 identifies, and the reason D7 orders the adapter fan-out by pillar coverage.
--
-- **These three normalise `as_is`, not `percentile`, and the difference is the point.**
-- Percentile answers "how do you compare with the others here", which needs no configuration
-- and is why the first three used it. An `Index` can do better: it carries the bounds its
-- publisher declared, so `as_is` maps -2.5..2.5 onto the score scale deterministically, with no
-- anchor anyone had to invent (D6-A, docs/d6-scale-anchors.md). A rule-of-law score then means
-- "where this country sits on the World Bank's own scale" rather than "where it sits among the
-- 32 we happen to be ranking" -- an absolute reading that does not move when the candidate list
-- does.
--
-- Higher is better for all three: WGI is signed so that more rule of law, more control of
-- corruption and more stability are all larger numbers.
--
-- **Weights are provisional, as every weight in this project is** (CLAUDE.md, Conventions).
-- Four pillars now carry data and the 60/40 split of two no longer describes anything; these
-- are a reasonable starting point for a set whose whole purpose is to be adjusted.
-- depends: 0122-only-a-comparable-figure-can-be-scored

UPDATE pillar_weight SET weight = 30 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'culture';

INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'governance', 'country', 30),
    ('minimal', 'safety',     'country', 20)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

-- Criterion weights sum to 100 WITHIN a pillar: governance splits between its two, and
-- political stability is the only safety attribute anything has figures for.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, declared.weight, declared.goal,
       'as_is', false
FROM   (VALUES
    ('country.rule_of_law',                   50, 'maximise'),
    ('country.control_of_corruption',         50, 'maximise'),
    ('country.political_economic_stability', 100, 'maximise')
) AS declared (attribute, weight, goal)
JOIN   attribute AS a ON a.id = declared.attribute
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
