-- Catalog: the shipped default criteria set -- the subjective half of reqs.md 7.
--
-- The weights, goals and blocks_if_missing flags of 7.1 and 7.5 are one opinion about the 41
-- attributes, not properties of them. Yours and your partner's will differ over the same rows and
-- neither changes what is measured (reqs.md 7, 3.4). Every number here is provisional.
-- depends: 0103-catalog-rules

INSERT INTO criteria_set (id, name) VALUES
    ('local_employment', 'Local employment')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The section headings of 7.1. Eleven weights, summing to 100 within the country level and
-- independently of any other level. Nothing is locked: a lock is something you decide, and
-- shipping one would pin a provisional number against the rebalancing meant to move it.
INSERT INTO pillar_weight (criteria_set, pillar, weight) VALUES
    ('local_employment', 'economics', 14),
    ('local_employment', 'housing', 10),
    ('local_employment', 'career', 14),
    ('local_employment', 'safety', 12),
    ('local_employment', 'health', 9),
    ('local_employment', 'climate', 7),
    ('local_employment', 'connectivity', 8),
    ('local_employment', 'nature', 8),
    ('local_employment', 'culture', 6),
    ('local_employment', 'governance', 8),
    ('local_employment', 'family', 4)
ON CONFLICT (criteria_set, pillar) DO UPDATE SET weight = EXCLUDED.weight;

-- One criterion per attribute, weighted within its pillar to 100.
--
-- goal is read off each attribute's own definition -- minimise a cost, maximise a benefit. The
-- one exception is country.avg_annual_temperature, which reqs.md 3.4 and 5.1 both name as the
-- case where a direction is wrong and only a band will do; its four numbers are the worked
-- example of 5.1 and are provisional like every other number here.
--
-- normalisation_method follows the legal scales of reqs.md 3.3a. Index and AssignedScore rescale
-- from bounds the provider declared and need no anchors; everything numeric defaults to `fixed`
-- (5.1). LabelSet has no legal scale and the column is NOT NULL, so it takes the method that
-- rescales nothing.
--
-- No criterion_scale_anchor rows ship. The `fixed` scale needs anchor pairs -- "500 EUR -> 100,
-- 2500 EUR -> 0" -- and reqs.md states none for any country attribute. They are Alex's to set;
-- inventing them would decide by default what the app exists to ask.
--
-- No criterion_threshold_* rows ship either, for the same reason: 7.1 tabulates no matching
-- thresholds. A criterion with no threshold lowers a score and never makes a candidate not
-- match, which is the honest state until a threshold is chosen.
INSERT INTO criterion (
    criteria_set, attribute, value_type, weight, goal,
    target_range_min, target_range_max, zero_score_below, zero_score_above,
    normalisation_method, blocks_if_missing
) VALUES
    ('local_employment', 'country.cost_of_living_index', 'Index', 35, 'minimise', NULL, NULL, NULL, NULL, 'as_is', true),
    ('local_employment', 'country.income_tax_effective', 'Ratio', 30, 'minimise', NULL, NULL, NULL, NULL, 'fixed', true),
    ('local_employment', 'country.remote_work_tax_treaty', 'LabelSet', 20, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.economic_outlook', 'Quantity', 15, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.house_price_to_income_ratio', 'Ratio', 40, 'minimise', NULL, NULL, NULL, NULL, 'fixed', true),
    ('local_employment', 'country.housing_cost_overburden_rate', 'Ratio', 35, 'minimise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.overcrowding_rate', 'Ratio', 25, 'minimise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.tech_software_jobs', 'Count', 22, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.tech_product_jobs', 'Count', 22, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.international_employers', 'LabelSet', 18, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.average_working_hours', 'Quantity', 15, 'minimise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.tech_employment_share', 'Ratio', 13, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.statutory_paid_leave', 'Quantity', 10, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.crime_safety_index', 'Index', 50, 'maximise', NULL, NULL, NULL, NULL, 'as_is', true),
    ('local_employment', 'country.political_economic_stability', 'Index', 50, 'maximise', NULL, NULL, NULL, NULL, 'as_is', true),
    ('local_employment', 'country.healthcare_system_quality', 'Index', 100, 'maximise', NULL, NULL, NULL, NULL, 'as_is', true),
    ('local_employment', 'country.climate_zone', 'LabelSet', 30, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.avg_annual_temperature', 'Quantity', 25, 'target_range', 18, 26, 5, 38, 'fixed', false),
    ('local_employment', 'country.annual_sunshine_hours', 'Quantity', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.projected_summer_heat_days', 'Quantity', 20, 'minimise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.rail_network_density', 'Quantity', 30, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.international_air_connectivity', 'Count', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.broadband_coverage', 'Ratio', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.road_network_quality', 'Quantity', 20, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.natural_diversity', 'Count', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.protected_land_share', 'Ratio', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.coastline_access', 'Quantity', 20, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.forest_cover', 'Ratio', 15, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.elevation_range', 'Quantity', 15, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.life_satisfaction', 'Quantity', 40, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.openness_to_foreigners', 'Index', 35, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.english_proficiency', 'Index', 25, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.rule_of_law', 'Index', 25, 'maximise', NULL, NULL, NULL, NULL, 'as_is', true),
    ('local_employment', 'country.naturalisation_pathway', 'Quantity', 25, 'minimise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.control_of_corruption', 'Index', 20, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.residency_admin_ease', 'AssignedScore', 15, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.press_freedom', 'Index', 10, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.pension_portability', 'AssignedScore', 5, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.school_system_quality', 'Index', 45, 'maximise', NULL, NULL, NULL, NULL, 'as_is', false),
    ('local_employment', 'country.parental_leave_policy', 'Quantity', 30, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false),
    ('local_employment', 'country.child_benefit_policy', 'Monetary', 25, 'maximise', NULL, NULL, NULL, NULL, 'fixed', false)
ON CONFLICT (criteria_set, attribute) DO UPDATE SET
    value_type           = EXCLUDED.value_type,
    weight               = EXCLUDED.weight,
    goal                 = EXCLUDED.goal,
    target_range_min     = EXCLUDED.target_range_min,
    target_range_max     = EXCLUDED.target_range_max,
    zero_score_below     = EXCLUDED.zero_score_below,
    zero_score_above     = EXCLUDED.zero_score_above,
    normalisation_method = EXCLUDED.normalisation_method,
    blocks_if_missing    = EXCLUDED.blocks_if_missing;

-- The gates this set enforces. All four are on: the three visa and quota rules are why the seed
-- was widened past the EU at all (reqs.md 7.3), and not_manually_excluded is a no-op until a
-- country is actually excluded -- it is the mechanism pruning uses, not a pruning.
INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced) VALUES
    ('local_employment', 'eu_free_movement', true),
    ('local_employment', 'uk_skilled_worker', true),
    ('local_employment', 'ch_eu_efta_quota', true),
    ('local_employment', 'not_manually_excluded', true)
ON CONFLICT (criteria_set, match_rule) DO UPDATE SET is_enforced = EXCLUDED.is_enforced;

-- Both compound rules ship inactive. Their thresholds are TBD (reqs.md 7.4), and a rule with no
-- threshold cannot fire; recording it as applied would claim a check that is not happening.
INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied) VALUES
    ('local_employment', 'mild_now_brutal_later', false),
    ('local_employment', 'cheap_but_taxed', false)
ON CONFLICT (criteria_set, compound_rule) DO UPDATE SET is_applied = EXCLUDED.is_applied;
