-- `country.total_tax_rate_effective` replaces `country.income_tax_effective`.
--
-- **What changed, in the household's words** (2026-09-11): "what everybody needs to see is the
-- total tax that's applied to their salary. Whether this total has three components in Romania
-- and four in Lithuania is not important. We need to compare apples to apples." Q205.
--
-- **Why the old measure was not apples to apples.** It was income tax plus the *employee's*
-- social contributions, over gross pay -- Eurostat `earn_nt_net`. That penalises every country
-- that puts contributions on the employee rather than the employer. Romania moved almost all of
-- them onto the employee in 2018, so it came out the heaviest of 31 at 41.5%, while Switzerland
-- looked light at 18.1% with its employer contributions invisible. The same money, split
-- differently, measured as though it were different money.
--
-- **The new measure is the tax wedge**: income tax plus employee *and employer* contributions,
-- over the total cost of employing the person -- gross plus the employer's share. Over labour
-- cost rather than gross, because the employer's contributions sit on top of gross; dividing by
-- gross would make the rate depend on the split all over again. OECD's headline measure, for
-- exactly this reason.
--
-- **At 167% of the average wage**, the highest income step OECD and Eurostat both model. A
-- progressive system bites harder as salary rises -- Belgium is 52.5% at the average wage and
-- 58.6% at 167% -- and a skilled worker relocating is above average. It is an *effective* rate at
-- that income, not the top marginal bracket: a top bracket taxes the last euro, not the salary,
-- and mixing marginal rates for progressive countries with effective rates for flat ones would
-- break the comparison this whole change exists to make. Applying each country's brackets to the
-- household's own salary is post-MVP (`devplan.md` 8).
--
-- **A new attribute, not a renamed one.** Identifiers are immutable (`reqs.md` 3.3), and this is
-- a different measurement, not a new name for the same one. The old attribute is retired: its
-- 31 employee-side figures stay stored and attached to it, unscored and still readable -- the
-- same treatment `0442` gave `crime_safety_index`.
-- depends: 0444-house-price-ratio-stops-blocking

INSERT INTO attribute (id, pillar, level, value_type, name, description, max_age, manual_entry)
VALUES (
    'country.total_tax_rate_effective', 'economics', 'country', 'Ratio',
    'Total effective tax rate',
    'income tax plus employee and employer social contributions, as a share of total labour '
    'cost, for a single person earning 167% of the average wage',
    INTERVAL '24 months', false
)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO attribute_ratio_parameter (attribute, value_type, basis)
VALUES ('country.total_tax_rate_effective', 'Ratio', 'labour_cost')
ON CONFLICT (attribute) DO UPDATE SET basis = EXCLUDED.basis;

-- OECD's Taxing Wages first; the five EU members OECD does not cover come from per-country
-- sources in a later migration, ranked behind it.
INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.total_tax_rate_effective', 'oecd', 1)
ON CONFLICT (attribute, data_source) DO UPDATE SET rank = EXCLUDED.rank;

-- The shipped set's criterion moves across unchanged: same weight, same goal, same method, still
-- blocking. Only what it measures is different.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT old.criteria_set, 'country.total_tax_rate_effective', old.pillar, 'Ratio', old.is_scored,
       old.weight, old.goal, old.normalisation_method, old.blocks_if_missing
FROM   criterion AS old
WHERE  old.attribute = 'country.income_tax_effective';

DELETE FROM criterion WHERE attribute = 'country.income_tax_effective';

UPDATE attribute SET lifecycle_status = 'retired' WHERE id = 'country.income_tax_effective';
