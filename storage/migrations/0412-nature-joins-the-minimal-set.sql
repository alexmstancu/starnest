-- The nature pillar becomes scoreable, on one of its five attributes.
--
-- `protected_land_share` is the only one of the five that Eurostat answers as a finished
-- figure. `forest_cover` and `coastline_access` are shares and densities of land area, and
-- Eurostat publishes the numerator without the denominator -- wooded land in thousand hectares,
-- not as a percentage -- so they are derived rather than fetched and wait for the attribute
-- that carries land area. `elevation_range` is Copernicus and `natural_diversity` is derived
-- from the other four.
--
-- **It answers 27 of the 32, and the five it misses are the honest kind.** The series is built
-- on EU reporting, so Switzerland, Iceland, Liechtenstein, Norway and the United Kingdom are
-- outside it. They lose this criterion's weight to redistribution and their coverage says so,
-- which is what `reqs.md` 5.3 asks for.
--
-- `percentile`, because a Ratio carries no published bounds and what counts as a *good* share
-- of protected land is a judgement about a distribution -- answered per attribute once the
-- distribution exists (D6(C)), not before.
--
-- Higher is better. Weights are provisional, as every weight in this project is.
-- depends: 0441-health-joins-the-minimal-set

UPDATE pillar_weight SET weight = 16 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 10 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 18 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 11 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 12 WHERE criteria_set = 'minimal' AND pillar = 'career';
UPDATE pillar_weight SET weight =  9 WHERE criteria_set = 'minimal' AND pillar = 'connectivity';
UPDATE pillar_weight SET weight = 14 WHERE criteria_set = 'minimal' AND pillar = 'health';

INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'nature', 'country', 10)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, 100, 'maximise', 'percentile', false
FROM   attribute AS a
WHERE  a.id = 'country.protected_land_share'
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
