-- Catalog: the named gates of reqs.md 7.3 and the compound rules of 7.4, at country level.
--
-- Both tables hold the rule itself, which is a fact about the world. Whether a rule is enforced
-- or applied is a preference and belongs to a criteria set (reqs.md 3.7, 3.7a) -- migration 0104.
-- depends: 0102-catalog-countries

-- The four rules that reach the country level. two_role_feasibility is city-level and is not
-- seeded here. A NULL level means the rule applies at every level.
INSERT INTO match_rule (id, level, name) VALUES
    ('eu_free_movement', 'country', 'EU/EEA free movement'),
    ('uk_skilled_worker', 'country', 'UK Skilled Worker route'),
    ('ch_eu_efta_quota', 'country', 'Swiss EU/EFTA permit quota'),
    ('not_manually_excluded', NULL, 'Not manually excluded')
ON CONFLICT (id) DO UPDATE SET
    level = EXCLUDED.level,
    name  = EXCLUDED.name;

-- The two country-level compound rules. Both are AllConditionsHold: each reads two figures and
-- flags the country when both conditions hold at once, each condition measured in its own
-- attribute's own unit.
--
-- Both were originally written as a ratio between the two attributes, and a ratio was wrong for
-- both. "Mild now, brutal later" would have divided degrees Celsius by a count of days -- an
-- interval scale over a count, where the units do not cancel, the quotient means nothing, and
-- countries whose annual mean sits near 0 degrees send it to infinity and then flip its sign.
-- "Cheap but taxed" would have divided a cost index by a tax percentage. Read plainly, neither
-- is a ratio: each says "the first figure looks good AND the second one undoes it", which is a
-- conjunction of two independent thresholds.
--
-- Rule-level thresholds are NULL because the shape has none; the per-condition thresholds below
-- are NULL because reqs.md 7.4 marks every one of them TBD, and 0104 leaves both rules inactive
-- in the shipped set (devplan.md 0.3 rule 2: seed it NULL and leave the rule inactive; never
-- invent a number).
INSERT INTO compound_rule (id, name, level, shape, outcome, threshold_min, threshold_max) VALUES
    ('mild_now_brutal_later', 'Mild now, brutal later', 'country', 'AllConditionsHold', 'warning', NULL, NULL),
    ('cheap_but_taxed', 'Cheap but taxed', 'country', 'AllConditionsHold', 'warning', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    level         = EXCLUDED.level,
    shape         = EXCLUDED.shape,
    outcome       = EXCLUDED.outcome,
    threshold_min = EXCLUDED.threshold_min,
    threshold_max = EXCLUDED.threshold_max;

-- The conditions, one row per attribute the rule reads. `ordinal` fixes the order they are
-- displayed and explained in; it carries no arithmetic meaning, because AND does not care about
-- order. Neither rule reads a household field, which is why neither has a compound_rule_input
-- row -- that table serves the two shapes that compare a list of figures as a whole.
--
-- Every bound is NULL, so every condition is undecided and neither rule can fire. The numbers
-- are Alex's to set once real figures exist: "mild" and "brutal" are exactly the judgements the
-- app is being built to make, not ones it should ship pre-made.
INSERT INTO compound_rule_condition (compound_rule, shape, ordinal, attribute, threshold_min, threshold_max) VALUES
    ('mild_now_brutal_later', 'AllConditionsHold', 1, 'country.avg_annual_temperature', NULL, NULL),
    ('mild_now_brutal_later', 'AllConditionsHold', 2, 'country.projected_summer_heat_days', NULL, NULL),
    ('cheap_but_taxed', 'AllConditionsHold', 1, 'country.cost_of_living_index', NULL, NULL),
    ('cheap_but_taxed', 'AllConditionsHold', 2, 'country.income_tax_effective', NULL, NULL)
ON CONFLICT (compound_rule, ordinal) DO UPDATE SET
    shape         = EXCLUDED.shape,
    attribute     = EXCLUDED.attribute,
    threshold_min = EXCLUDED.threshold_min,
    threshold_max = EXCLUDED.threshold_max;
