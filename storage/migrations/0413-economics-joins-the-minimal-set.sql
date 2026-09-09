-- The economics pillar becomes scoreable, on the one of its four attributes that is fetchable.
--
-- **The other three are blocked on the catalog, not on effort**, and it is worth writing down
-- which is which so nobody spends a day on an adapter that cannot help:
--
--   * `cost_of_living_index` is typed `Index` and declares no bounds. Its description says
--     "Eurostat PLI, EU27 = 100", which is a *base*, not a range -- so there is nothing for an
--     Index payload to sit inside and no value can be stored against it at all. Whether it is
--     really a Ratio to the EU average is a modelling question, not a fetching one.
--   * `income_tax_effective` is OECD's, and OECD does not cover six of the 32 -- including
--     Romania, which is the household's own country and the comparison anchor (reqs.md Q30).
--   * `remote_work_tax_treaty` is a LabelSet, which `0122` established cannot be scored.
--
-- **`economic_outlook` is the only forecast in the catalog**, and the adapter carries that in
-- two places rather than arguing about it: the confidence is `medium` because a projection is
-- not a measurement, and the reference period is the year forecast, so nothing reads it as
-- current. It answers all 32 candidates -- the only source so far that answers Liechtenstein.
--
-- `percentile`, because a Quantity carries no published bounds and what counts as *good*
-- projected growth is a judgement about a distribution (D6(C)). Higher is better: a growing
-- economy is a deeper market for the household's work.
--
-- Weights are provisional, as every weight in this project is.
-- depends: 0412-nature-joins-the-minimal-set

UPDATE pillar_weight SET weight = 14 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight =  9 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 16 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 10 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 11 WHERE criteria_set = 'minimal' AND pillar = 'career';
UPDATE pillar_weight SET weight =  8 WHERE criteria_set = 'minimal' AND pillar = 'connectivity';
UPDATE pillar_weight SET weight = 13 WHERE criteria_set = 'minimal' AND pillar = 'health';
UPDATE pillar_weight SET weight =  9 WHERE criteria_set = 'minimal' AND pillar = 'nature';

INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('minimal', 'economics', 'country', 10)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, 100, 'maximise', 'percentile', false
FROM   attribute AS a
WHERE  a.id = 'country.economic_outlook'
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    normalisation_method = EXCLUDED.normalisation_method;
