-- The health pillar becomes scoreable, and it is the only pillar one attribute completes.
--
-- Same reasoning as `0410` and `0411`: a figure nothing scores is a figure nobody sees. Health
-- holds exactly one attribute in the catalog, so `healthcare_system_quality` takes the pillar
-- from nothing to complete -- and it is one of the seven the shipped set will not score without
-- (reqs.md 7.5).
--
-- **`as_is`, and here it needs no argument at all.** The WHO UHC Service Coverage Index is
-- published 0 to 100 by its own publisher, so mapping it onto a 0-100 score scale is the
-- identity: no anchor invented, no rescaling, and the score means exactly what WHO says the
-- figure means. This is D6(A) at its least controversial -- the governance indices at least had
-- to be moved from -2.5..2.5.
--
-- Higher is better: the index counts the share of a population receiving the essential services
-- it needs without financial hardship.
--
-- **Weights are provisional, as every weight in this project is** (CLAUDE.md, Conventions).
-- Seven pillars now carry data and the six-way split of `0411` no longer describes anything.
-- depends: 0440-country-codes-alpha-3

UPDATE pillar_weight SET weight = 18 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 13 WHERE criteria_set = 'minimal' AND pillar = 'career';

INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'health', 'country', 15)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, 100, 'maximise', 'as_is', false
FROM   attribute AS a
WHERE  a.id = 'country.healthcare_system_quality'
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
