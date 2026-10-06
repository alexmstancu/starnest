-- `child_benefit_policy` becomes a Quantity: family cash benefits as a share of the average
-- wage, which is what OECD publishes, rather than the `EUR/month per child` the catalog
-- declared and no source supplies per country in a scriptable form.
--
-- **The third instance of the fault 0443 fixed** (`cost_of_living_index`), alongside
-- `house_price_to_income_ratio`: an attribute declaring a quantity its own rank-1 source does
-- not publish, so it could hold no value and scored nothing for every candidate. OECD's
-- PF1.3 gives total family cash benefits for a two-child family as a percentage of average
-- full-time earnings, 31 of the 32 covered (Liechtenstein absent, left unanswered, as
-- `oecd_parental_leave` leaves it). The household chose the two-parent two-earner family type
-- on 2026-10-06 over the other two the chart publishes; a figure carries one.
--
-- **`percentile`, not `fixed`.** The criterion was `fixed` with no anchors, which is how it
-- scored a silent zero -- `fixed` reads a figure as already being out of the scale. What a
-- benefit level means is its standing among the 32 (the PISA reasoning of 0478, the
-- housing-price reasoning of 0488), and anchoring it absolutely would mean inventing what
-- a tenth of the wage is worth.
--
-- **Lift and restore, because the FK is composite.** `criterion_matches_attribute_type` is a
-- non-deferrable foreign key on `(attribute, value_type)`, so the attribute and its criteria
-- cannot change type one before the other. The attribute has no stored values yet (0 of 32),
-- so there is no `value_matches_attribute_type` wall of the kind 0478 met.
--
-- depends: 0491-forest-cover-can-finally-be-scored

CREATE TEMP TABLE lifted AS
SELECT criteria_set, attribute, pillar, is_scored, weight, weight_locked, goal,
       target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   criterion WHERE attribute = 'country.child_benefit_policy';

DELETE FROM criterion WHERE attribute = 'country.child_benefit_policy';

UPDATE attribute
SET    value_type = 'Quantity',
       description = 'OECD total family cash benefits for a two-child family, two-parent two-earner, as a percentage of average full-time earnings. A share of a base, not a range'
WHERE  id = 'country.child_benefit_policy';

-- The unit vocabulary is a table, so a new unit is a row rather than a string nobody checks.
INSERT INTO unit (id, name)
VALUES ('pct_of_average_wage', '% of average full-time earnings')
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.child_benefit_policy', 'Quantity', 'pct_of_average_wage')
ON CONFLICT (attribute) DO UPDATE SET value_type = 'Quantity', unit = 'pct_of_average_wage';

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, target_range_min,
                       target_range_max, zero_score_below, zero_score_above, blocks_if_missing,
                       breakdown_option, reducer_mode)
SELECT criteria_set, attribute, pillar, 'Quantity', is_scored, weight, weight_locked, goal,
       'percentile', target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   lifted;

DROP TABLE lifted;

-- The allowed range (min 0) and the source priority (oecd first) carry over unchanged: both
-- are still true of a percentage, and a run already reaches it under the OECD adapter.

DO $$
DECLARE
    wrong integer;
BEGIN
    SELECT count(*) INTO wrong
    FROM   attribute a
    LEFT   JOIN attribute_quantity_parameter q ON q.attribute = a.id
    WHERE  a.id = 'country.child_benefit_policy'
      AND  (a.value_type <> 'Quantity' OR q.unit IS NULL);
    IF wrong <> 0 THEN
        RAISE EXCEPTION 'child_benefit_policy did not become a Quantity with a unit';
    END IF;
END $$;
