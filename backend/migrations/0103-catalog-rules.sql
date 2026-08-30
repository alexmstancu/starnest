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

-- The two country-level compound rules. Both thresholds are NULL on both rules because reqs.md
-- 7.4 marks them TBD, and 0104 leaves both rules inactive in the shipped set. A ratio that reads
-- well in the abstract usually turns out wrong against real figures, and these have met none
-- (devplan.md 0.3 rule 2: seed it NULL and leave the rule inactive; never invent a number).
INSERT INTO compound_rule (id, name, level, shape, outcome, threshold_min, threshold_max) VALUES
    ('mild_now_brutal_later', 'Mild now, brutal later', 'country', 'RatioBetweenAttributes', 'warning', NULL, NULL),
    ('cheap_but_taxed', 'Cheap but taxed', 'country', 'RatioBetweenAttributes', 'warning', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    level         = EXCLUDED.level,
    shape         = EXCLUDED.shape,
    outcome       = EXCLUDED.outcome,
    threshold_min = EXCLUDED.threshold_min,
    threshold_max = EXCLUDED.threshold_max;

-- Inputs in order: a ratio of A to B is not a ratio of B to A. Neither country rule reads a
-- household field, so household_field is NULL on every row.
INSERT INTO compound_rule_input (compound_rule, input_order, attribute, household_field) VALUES
    ('mild_now_brutal_later', 1, 'country.avg_annual_temperature', NULL),
    ('mild_now_brutal_later', 2, 'country.projected_summer_heat_days', NULL),
    ('cheap_but_taxed', 1, 'country.cost_of_living_index', NULL),
    ('cheap_but_taxed', 2, 'country.income_tax_effective', NULL)
ON CONFLICT (compound_rule, input_order) DO UPDATE SET
    attribute       = EXCLUDED.attribute,
    household_field = EXCLUDED.household_field;
