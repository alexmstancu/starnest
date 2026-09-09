-- The two pillars W4-F opened become something that scores.
--
-- Same reasoning as `0410`: a figure nothing scores is a figure nobody sees. `tech_employment_share`
-- and `broadband_coverage` were chosen precisely because they open pillars nothing had answered
-- (devplan.md D7), and leaving them out of the only scoreable set would waste that.
--
-- **Both normalise `percentile`, and that is forced rather than chosen.** A Ratio carries no
-- published bounds the way an Index does, so `as_is` has nothing to map from, and `fixed` needs
-- anchors that would have to be invented -- what counts as a *good* share of ICT employment is
-- a judgement about a distribution, and D6(C) settled that those are made per attribute once
-- the distribution exists. Percentile needs nothing and states the honest thing: how this
-- country stands among the others being ranked.
--
-- Higher is better for both. More ICT employment is a deeper market for the household's work;
-- more households reachable at 100 Mbit/s is more places it is possible to live and still work.
--
-- **Weights are provisional, as every weight in this project is** (CLAUDE.md, Conventions).
-- Six pillars now carry data and the four-way split of `0410` no longer describes anything.
-- depends: 0410-governance-joins-the-minimal-set

UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 25 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'safety';

INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'career',       'country', 15),
    ('minimal', 'connectivity', 'country', 10)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

-- Each new pillar has exactly one attribute with figures, so each criterion takes all of its
-- pillar's weight.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, 100, 'maximise', 'percentile', false
FROM   (VALUES
    ('country.tech_employment_share'),
    ('country.broadband_coverage')
) AS declared (attribute)
JOIN   attribute AS a ON a.id = declared.attribute
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
