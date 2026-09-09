-- The safety criterion splits: a measured rate we score, and a composite we do not.
--
-- **What was wrong.** `country.crime_safety_index` declared Numbeo's 0-100 bounds and named
-- UNODC as its rank-1 source. Those are different quantities on different scales -- a homicide
-- rate stored under Numbeo's bounds would have been wrong in a way nothing downstream could
-- detect -- and Numbeo's API is $50-500/month, so the bounds and the priority could not both
-- stand. Decided 2026-09-09 (docs/catalog-blockers.md item 2).
--
-- **The split follows the rule the ontology already states**: raw indicators become attributes,
-- composite scores become external scores, and the test is whether somebody else has already
-- applied weights (reqs.md 3.5a). A homicide rate is a measurement. Numbeo's crime index is a
-- crowdsourced composite, so it is an `ExternalScore` displayed beside our number and never
-- inside it -- which needs no attribute at all, and no subscription until somebody wants to see
-- it on screen.
--
-- **`country.homicide_rate` is answered by Eurostat, not UNODC**, and that is a better outcome
-- than the plan expected. `sdg_16_10` is a *standardised death rate* from cause-of-death
-- statistics, which is far more comparable across countries than police-recorded offences --
-- recording practice varies enormously and the recording, not the crime, is what differs. It
-- answers all 32 candidates. UNODC and WHO stay in the priority order behind it.
--
-- **It is narrower than what it replaces, and the name says so.** "Crime and safety" became
-- "homicide rate": one measured thing rather than an unmeasured aggregate of several. That is
-- the trade the ontology asks for, and naming it `crime_safety_index` would have hidden it.
--
-- `crime_safety_index` is retired rather than deleted. Nothing references it once its criterion
-- is gone, and a retired attribute keeps the account of why it existed.
-- depends: 0413-economics-joins-the-minimal-set

INSERT INTO unit (id, name) VALUES
    ('per_100000_population', 'Per 100,000 population')
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute (id, pillar, level, value_type, name, description, max_age, manual_entry)
VALUES (
    'country.homicide_rate', 'safety', 'country', 'Quantity',
    'Homicide rate',
    'standardised death rate due to assault, per 100,000 population',
    INTERVAL '24 months', false
)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.homicide_rate', 'Quantity', 'per_100000_population')
ON CONFLICT (attribute) DO UPDATE SET unit = EXCLUDED.unit;

INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.homicide_rate', 'eurostat', 1),
    ('country.homicide_rate', 'unodc',    2),
    ('country.homicide_rate', 'who',      3)
ON CONFLICT (attribute, data_source) DO UPDATE SET rank = EXCLUDED.rank;

-- The shipped set: the new criterion takes the weight and the blocking role the old one had.
-- **`minimise`, where the old one was `maximise`** -- a safety *index* goes up as things get
-- better and a homicide *rate* goes down, and getting this backwards would have ranked Europe
-- exactly upside down on this criterion.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'local_employment', a.id, a.pillar, a.value_type, true, old.weight, 'minimise',
       old.normalisation_method, old.blocks_if_missing
FROM   attribute AS a
JOIN   criterion AS old
       ON old.criteria_set = 'local_employment'
      AND old.attribute = 'country.crime_safety_index'
WHERE  a.id = 'country.homicide_rate'
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight,
    goal = EXCLUDED.goal,
    blocks_if_missing = EXCLUDED.blocks_if_missing;

DELETE FROM criterion
WHERE criteria_set = 'local_employment' AND attribute = 'country.crime_safety_index';

UPDATE attribute SET lifecycle_status = 'retired' WHERE id = 'country.crime_safety_index';
