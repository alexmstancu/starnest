-- How fast each attribute's data goes stale.
--
-- reqs.md 6.6 has always said every attribute declares a `max_age`, and 0101 seeded NULL for
-- all 41 with a comment saying so: the document gave no values, and inventing staleness
-- horizons would have been the fabrication devplan.md 0.3 forbids. The consequence was that
-- **rule 2 of the active-value view has never fired against real data** and the age downgrade
-- in the confidence derivation had no input -- a documented mechanism, fully built and tested,
-- that had never once run (known-issues D7).
--
-- reqs.md 7.1 now carries the column, and a rule rather than 41 opinions: a value is stale once
-- TWICE its source's publication interval has passed since the period it describes. Annual
-- indicators get 24 months, a twice-yearly forecast 12, a monthly flow 3, a triennial survey
-- 72. The values below are generated from that table, so the document and the database cannot
-- drift apart -- and a change of tolerance is an edit to one sentence there, then a new
-- migration here.
--
-- 4 attributes are deliberately left NULL and are not listed below. A Koeppen climate zone,
-- a coastline and an elevation range do not go out of date on this horizon, and
-- country.natural_diversity is derived from other attributes and has no publication of its
-- own. NULL is read as "never stale" by the view, which is exactly what is meant.
--
-- An interval rather than a day count, because the column is an interval and the difference
-- matters: `interval '1 mon'` added to 31 January is not 30 days added to it.
-- depends: 0110-evaluation-note

UPDATE attribute AS a
SET    max_age = declared.max_age
FROM   (VALUES
    ('country.cost_of_living_index', interval '24 months'),
    ('country.income_tax_effective', interval '24 months'),
    ('country.remote_work_tax_treaty', interval '24 months'),
    ('country.economic_outlook', interval '12 months'),
    ('country.house_price_to_income_ratio', interval '24 months'),
    ('country.housing_cost_overburden_rate', interval '24 months'),
    ('country.overcrowding_rate', interval '24 months'),
    ('country.tech_software_jobs', interval '3 months'),
    ('country.tech_product_jobs', interval '3 months'),
    ('country.international_employers', interval '12 months'),
    ('country.average_working_hours', interval '24 months'),
    ('country.tech_employment_share', interval '24 months'),
    ('country.statutory_paid_leave', interval '24 months'),
    ('country.crime_safety_index', interval '24 months'),
    ('country.political_economic_stability', interval '24 months'),
    ('country.healthcare_system_quality', interval '24 months'),
    ('country.avg_annual_temperature', interval '60 months'),
    ('country.annual_sunshine_hours', interval '60 months'),
    ('country.projected_summer_heat_days', interval '60 months'),
    ('country.rail_network_density', interval '24 months'),
    ('country.international_air_connectivity', interval '24 months'),
    ('country.broadband_coverage', interval '24 months'),
    ('country.road_network_quality', interval '24 months'),
    ('country.protected_land_share', interval '24 months'),
    ('country.forest_cover', interval '60 months'),
    ('country.life_satisfaction', interval '24 months'),
    ('country.openness_to_foreigners', interval '60 months'),
    ('country.english_proficiency', interval '24 months'),
    ('country.rule_of_law', interval '24 months'),
    ('country.naturalisation_pathway', interval '24 months'),
    ('country.control_of_corruption', interval '24 months'),
    ('country.residency_admin_ease', interval '24 months'),
    ('country.press_freedom', interval '24 months'),
    ('country.pension_portability', interval '24 months'),
    ('country.school_system_quality', interval '72 months'),
    ('country.parental_leave_policy', interval '24 months'),
    ('country.child_benefit_policy', interval '24 months')
) AS declared (attribute, max_age)
WHERE  a.id = declared.attribute;
