-- Catalog: the eleven country pillars and the 41 country attributes of reqs.md 7.1.
--
-- Attributes carry what is measured and nothing else. Weight, goal, threshold and scale anchor
-- are one opinion about them and live in a criteria set (reqs.md 7, 3.4) -- migration 0104.
-- depends: 0100-catalog-reference-data

-- Pillar identifiers are unprefixed (arch.md 3.2a). The name is the section heading of 7.1.
--
-- These eleven serve BOTH levels (reqs.md Q187) -- the same named concerns, differing only in
-- what they are worth, which is why no level appears here. The city level adds no pillar rows,
-- only city pillar_weight rows.
INSERT INTO pillar (id, name) VALUES
    ('economics', 'Economics'),
    ('housing', 'Housing'),
    ('career', 'Career & work'),
    ('safety', 'Safety & stability'),
    ('health', 'Health'),
    ('climate', 'Climate & environment'),
    ('connectivity', 'Connectivity'),
    ('nature', 'Nature & landscape'),
    ('culture', 'Culture & community'),
    ('governance', 'Governance & administration'),
    ('family', 'Family & education')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name;

-- The 41 country attributes. max_age is NULL throughout: reqs.md 6.6 says every attribute
-- declares one and gives none, and inventing a staleness horizon would be the same fabrication
-- as inventing a threshold (devplan.md 0.3).
--
-- manual_entry is true only where 7.1 names manual entry, the LLM or an official administrative
-- source as the way a value arrives. It defaults to forbidden everywhere else (reqs.md 6.5).
INSERT INTO attribute (id, pillar, level, value_type, name, description, max_age, manual_entry) VALUES
    ('country.cost_of_living_index', 'economics', 'country', 'Index', 'Cost of living index', 'Eurostat PLI, EU27 = 100', NULL, false),
    ('country.income_tax_effective', 'economics', 'country', 'Ratio', 'Income tax effective', 'share of gross income', NULL, false),
    ('country.remote_work_tax_treaty', 'economics', 'country', 'LabelSet', 'Remote work tax treaty', 'treaty partners; must include `home_country`', NULL, true),
    ('country.economic_outlook', 'economics', 'country', 'Quantity', 'Economic outlook', 'projected GDP growth, % per year', NULL, false),
    ('country.house_price_to_income_ratio', 'housing', 'country', 'Ratio', 'House price to income ratio', 'price ÷ annual income', NULL, false),
    ('country.housing_cost_overburden_rate', 'housing', 'country', 'Ratio', 'Housing cost overburden rate', 'share of households', NULL, false),
    ('country.overcrowding_rate', 'housing', 'country', 'Ratio', 'Overcrowding rate', 'share of households', NULL, false),
    ('country.tech_software_jobs', 'career', 'country', 'Count', 'Tech software jobs', 'open postings', NULL, false),
    ('country.tech_product_jobs', 'career', 'country', 'Count', 'Tech product jobs', 'open postings', NULL, false),
    ('country.international_employers', 'career', 'country', 'LabelSet', 'International employers', 'named firms', NULL, true),
    ('country.average_working_hours', 'career', 'country', 'Quantity', 'Average working hours', 'hours/week', NULL, false),
    ('country.tech_employment_share', 'career', 'country', 'Ratio', 'Tech employment share', 'share of workforce', NULL, false),
    ('country.statutory_paid_leave', 'career', 'country', 'Quantity', 'Statutory paid leave', 'days/year', NULL, false),
    ('country.crime_safety_index', 'safety', 'country', 'Index', 'Crime safety index', 'Numbeo 0–100', NULL, false),
    ('country.political_economic_stability', 'safety', 'country', 'Index', 'Political economic stability', 'World Bank WGI −2.5–2.5', NULL, false),
    ('country.healthcare_system_quality', 'health', 'country', 'Index', 'Healthcare system quality', 'WHO UHC 0–100', NULL, false),
    ('country.climate_zone', 'climate', 'country', 'LabelSet', 'Climate zone', 'Köppen codes', NULL, false),
    ('country.avg_annual_temperature', 'climate', 'country', 'Quantity', 'Avg annual temperature', '°C', NULL, false),
    ('country.annual_sunshine_hours', 'climate', 'country', 'Quantity', 'Annual sunshine hours', 'hours/year', NULL, false),
    ('country.projected_summer_heat_days', 'climate', 'country', 'Quantity', 'Projected summer heat days', 'days above 35 °C projected for 2050, SSP2-4.5', NULL, false),
    ('country.rail_network_density', 'connectivity', 'country', 'Quantity', 'Rail network density', 'km of line per 1,000 km²', NULL, false),
    ('country.international_air_connectivity', 'connectivity', 'country', 'Count', 'International air connectivity', 'international destinations served', NULL, false),
    ('country.broadband_coverage', 'connectivity', 'country', 'Ratio', 'Broadband coverage', 'share of households with high-speed or fibre access', NULL, false),
    ('country.road_network_quality', 'connectivity', 'country', 'Quantity', 'Road network quality', 'km of motorway per 1,000 km²', NULL, false),
    ('country.natural_diversity', 'nature', 'country', 'Count', 'Natural diversity', '0–6, feature types present', NULL, false),
    ('country.protected_land_share', 'nature', 'country', 'Ratio', 'Protected land share', 'share of territory', NULL, false),
    ('country.coastline_access', 'nature', 'country', 'Quantity', 'Coastline access', 'km coast per 1000 km²', NULL, false),
    ('country.forest_cover', 'nature', 'country', 'Ratio', 'Forest cover', 'share of land area', NULL, false),
    ('country.elevation_range', 'nature', 'country', 'Quantity', 'Elevation range', 'm', NULL, false),
    ('country.life_satisfaction', 'culture', 'country', 'Quantity', 'Life satisfaction', 'Cantril ladder 0–10', NULL, false),
    ('country.openness_to_foreigners', 'culture', 'country', 'Index', 'Openness to foreigners', 'MIPEX 0–100', NULL, false),
    ('country.english_proficiency', 'culture', 'country', 'Index', 'English proficiency', 'EF EPI 0–800', NULL, false),
    ('country.rule_of_law', 'governance', 'country', 'Index', 'Rule of law', 'World Bank WGI −2.5–2.5', NULL, false),
    ('country.naturalisation_pathway', 'governance', 'country', 'Quantity', 'Naturalisation pathway', 'years of residence', NULL, true),
    ('country.control_of_corruption', 'governance', 'country', 'Index', 'Control of corruption', 'World Bank WGI −2.5–2.5', NULL, false),
    ('country.residency_admin_ease', 'governance', 'country', 'AssignedScore', 'Residency admin ease', '0–100, rubric in §6.9', NULL, true),
    ('country.press_freedom', 'governance', 'country', 'Index', 'Press freedom', 'RSF 0–100', NULL, false),
    ('country.pension_portability', 'governance', 'country', 'AssignedScore', 'Pension portability', '0–100, rubric in §6.9', NULL, true),
    ('country.school_system_quality', 'family', 'country', 'Index', 'School system quality', 'OECD PISA mean score', NULL, false),
    ('country.parental_leave_policy', 'family', 'country', 'Quantity', 'Parental leave policy', 'weeks paid', NULL, false),
    ('country.child_benefit_policy', 'family', 'country', 'Monetary', 'Child benefit policy', 'EUR/month per child', NULL, false)
ON CONFLICT (id) DO UPDATE SET
    pillar       = EXCLUDED.pillar,
    level        = EXCLUDED.level,
    value_type   = EXCLUDED.value_type,
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    max_age      = EXCLUDED.max_age,
    manual_entry = EXCLUDED.manual_entry;

-- Type parameters. Each restates the value type so the composite key pins it (arch.md 3.3b).

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit) VALUES
    ('country.economic_outlook', 'Quantity', 'percent_per_year'),
    ('country.average_working_hours', 'Quantity', 'hours_per_week'),
    ('country.statutory_paid_leave', 'Quantity', 'days_per_year'),
    ('country.avg_annual_temperature', 'Quantity', 'celsius'),
    ('country.annual_sunshine_hours', 'Quantity', 'hours_per_year'),
    ('country.projected_summer_heat_days', 'Quantity', 'days_per_year'),
    ('country.rail_network_density', 'Quantity', 'km_per_1000_km2'),
    ('country.road_network_quality', 'Quantity', 'km_per_1000_km2'),
    ('country.coastline_access', 'Quantity', 'km_per_1000_km2'),
    ('country.elevation_range', 'Quantity', 'metre'),
    ('country.life_satisfaction', 'Quantity', 'ladder_points'),
    ('country.naturalisation_pathway', 'Quantity', 'years'),
    ('country.parental_leave_policy', 'Quantity', 'weeks')
ON CONFLICT (attribute) DO UPDATE SET unit = EXCLUDED.unit;

INSERT INTO attribute_ratio_parameter (attribute, value_type, basis) VALUES
    ('country.income_tax_effective', 'Ratio', 'gross_income'),
    ('country.house_price_to_income_ratio', 'Ratio', 'annual_income'),
    ('country.housing_cost_overburden_rate', 'Ratio', 'households'),
    ('country.overcrowding_rate', 'Ratio', 'households'),
    ('country.tech_employment_share', 'Ratio', 'workforce'),
    ('country.broadband_coverage', 'Ratio', 'households'),
    ('country.protected_land_share', 'Ratio', 'territory'),
    ('country.forest_cover', 'Ratio', 'land_area')
ON CONFLICT (attribute) DO UPDATE SET basis = EXCLUDED.basis;

-- Bounds are read off the value-type cell of 7.1. Two Index attributes name a provider and no
-- scale -- country.cost_of_living_index and country.school_system_quality -- so they get no
-- row rather than an invented range. `as_is` normalisation rescales from these bounds, so both
-- need a scale from Alex before they can be scored.
INSERT INTO attribute_index_parameter (attribute, value_type, provider, scale_min, scale_max) VALUES
    ('country.crime_safety_index', 'Index', 'Numbeo', 0, 100),
    ('country.political_economic_stability', 'Index', 'World Bank WGI', -2.5, 2.5),
    ('country.healthcare_system_quality', 'Index', 'WHO UHC', 0, 100),
    ('country.openness_to_foreigners', 'Index', 'MIPEX', 0, 100),
    ('country.english_proficiency', 'Index', 'EF EPI', 0, 800),
    ('country.rule_of_law', 'Index', 'World Bank WGI', -2.5, 2.5),
    ('country.control_of_corruption', 'Index', 'World Bank WGI', -2.5, 2.5),
    ('country.press_freedom', 'Index', 'RSF', 0, 100)
ON CONFLICT (attribute) DO UPDATE SET
    provider  = EXCLUDED.provider,
    scale_min = EXCLUDED.scale_min,
    scale_max = EXCLUDED.scale_max;

-- The two attribute-explicit validation ranges reqs.md 3.3a names. Validation says a figure is
-- not credible; it is not a matching threshold, which says a real figure is unacceptable.
INSERT INTO attribute_allowed_range (attribute, min_value, max_value) VALUES
    ('country.avg_annual_temperature', -20, 40),
    ('country.child_benefit_policy', 0, NULL)
ON CONFLICT (attribute) DO UPDATE SET
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value;

-- Source priority overrides, in the order the Sources column of 7.1 lists them. An override is
-- partial: every source it does not name keeps its global rank beneath these (reqs.md 6.6).
--
-- Replaced rather than upserted. UNIQUE (attribute, rank) means a reordering would collide
-- mid-statement against the ranks still standing, and a priority override has nothing behind it
-- to lose -- no value, no score, no history points at one.
DELETE FROM attribute_source_priority WHERE attribute IN ('country.cost_of_living_index', 'country.income_tax_effective', 'country.remote_work_tax_treaty', 'country.economic_outlook', 'country.house_price_to_income_ratio', 'country.housing_cost_overburden_rate', 'country.overcrowding_rate', 'country.international_employers', 'country.average_working_hours', 'country.tech_employment_share', 'country.statutory_paid_leave', 'country.crime_safety_index', 'country.political_economic_stability', 'country.healthcare_system_quality', 'country.climate_zone', 'country.avg_annual_temperature', 'country.annual_sunshine_hours', 'country.projected_summer_heat_days', 'country.rail_network_density', 'country.international_air_connectivity', 'country.broadband_coverage', 'country.road_network_quality', 'country.natural_diversity', 'country.protected_land_share', 'country.coastline_access', 'country.forest_cover', 'country.elevation_range', 'country.life_satisfaction', 'country.openness_to_foreigners', 'country.english_proficiency', 'country.rule_of_law', 'country.naturalisation_pathway', 'country.control_of_corruption', 'country.residency_admin_ease', 'country.press_freedom', 'country.pension_portability', 'country.school_system_quality', 'country.parental_leave_policy', 'country.child_benefit_policy');

INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.cost_of_living_index', 'eurostat', 1),
    ('country.cost_of_living_index', 'world_bank', 2),
    ('country.income_tax_effective', 'oecd', 1),
    ('country.income_tax_effective', 'national_tax_authority', 2),
    ('country.remote_work_tax_treaty', 'oecd', 1),
    ('country.remote_work_tax_treaty', 'manual', 2),
    ('country.economic_outlook', 'imf', 1),
    ('country.economic_outlook', 'european_commission', 2),
    ('country.economic_outlook', 'world_bank', 3),
    ('country.house_price_to_income_ratio', 'eurostat', 1),
    ('country.house_price_to_income_ratio', 'oecd', 2),
    ('country.housing_cost_overburden_rate', 'eurostat', 1),
    ('country.overcrowding_rate', 'eurostat', 1),
    ('country.international_employers', 'llm', 1),
    ('country.international_employers', 'company_website', 2),
    ('country.average_working_hours', 'oecd', 1),
    ('country.average_working_hours', 'eurostat', 2),
    ('country.tech_employment_share', 'eurostat', 1),
    ('country.tech_employment_share', 'ilo', 2),
    ('country.statutory_paid_leave', 'oecd', 1),
    ('country.statutory_paid_leave', 'european_commission', 2),
    ('country.statutory_paid_leave', 'national_law', 3),
    ('country.crime_safety_index', 'unodc', 1),
    ('country.crime_safety_index', 'eurostat', 2),
    ('country.political_economic_stability', 'world_bank', 1),
    ('country.healthcare_system_quality', 'who', 1),
    ('country.healthcare_system_quality', 'oecd', 2),
    ('country.climate_zone', 'koeppen', 1),
    ('country.avg_annual_temperature', 'open_meteo', 1),
    ('country.annual_sunshine_hours', 'open_meteo', 1),
    ('country.projected_summer_heat_days', 'copernicus', 1),
    ('country.rail_network_density', 'eurostat', 1),
    ('country.international_air_connectivity', 'eurostat', 1),
    ('country.international_air_connectivity', 'openflights', 2),
    ('country.international_air_connectivity', 'airport_authority', 3),
    ('country.broadband_coverage', 'eurostat', 1),
    ('country.broadband_coverage', 'national_regulator', 2),
    ('country.road_network_quality', 'eurostat', 1),
    ('country.natural_diversity', 'derived', 1),
    ('country.protected_land_share', 'protected_planet', 1),
    ('country.protected_land_share', 'eurostat', 2),
    ('country.coastline_access', 'natural_earth', 1),
    ('country.coastline_access', 'eurostat', 2),
    ('country.forest_cover', 'fao', 1),
    ('country.forest_cover', 'copernicus', 2),
    ('country.elevation_range', 'copernicus', 1),
    ('country.life_satisfaction', 'eurostat', 1),
    ('country.openness_to_foreigners', 'mipex', 1),
    ('country.openness_to_foreigners', 'eurobarometer', 2),
    ('country.openness_to_foreigners', 'internations', 3),
    ('country.english_proficiency', 'ef_epi', 1),
    ('country.rule_of_law', 'world_bank', 1),
    ('country.rule_of_law', 'v_dem', 2),
    ('country.naturalisation_pathway', 'national_law', 1),
    ('country.control_of_corruption', 'world_bank', 1),
    ('country.control_of_corruption', 'transparency_international', 2),
    ('country.residency_admin_ease', 'national_law', 1),
    ('country.residency_admin_ease', 'world_bank', 2),
    ('country.press_freedom', 'rsf', 1),
    ('country.pension_portability', 'european_commission', 1),
    ('country.pension_portability', 'national_social_security', 2),
    ('country.school_system_quality', 'oecd', 1),
    ('country.school_system_quality', 'unesco', 2),
    ('country.parental_leave_policy', 'oecd', 1),
    ('country.child_benefit_policy', 'oecd', 1),
    ('country.child_benefit_policy', 'national_social_security', 2);
