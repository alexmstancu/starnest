-- `school_system_quality` becomes a Quantity, and is scored on standing rather than as_is.
--
-- **Three faults, and it could not have held a value through any of them.**
--
-- 1. It is typed `Index` and declares no bounds, so `attribute_index_parameter` has no row for
--    it and an `Index` payload refuses every figure. This is `catalog-blockers.md` item 1
--    exactly -- the fault `cost_of_living_index` had, resolved by `0443` the same way: a PISA
--    score has a *base*, not a range. The scale is centred on 500 with a standard deviation of
--    100 and no ceiling, so `Quantity` with a unit naming the assessment is the honest type.
--    **This ontology reserves `Index` for figures whose bounds do the work.**
--
-- 2. Its normalisation is `as_is`, which treats a figure as already being a score out of the
--    scale. Estonia's 510 would read as 510 out of 100. This is the homicide-rate fault of
--    `0442` (P-series, `known-issues.md`): a method copied from an attribute that meant
--    something else. `reqs.md` 3.3a has always said a Quantity allows `fixed` and `percentile`
--    only, and `test_every_scored_criterion_uses_a_method_its_value_type_allows` enforces it.
--
-- 3. Its description said "OECD PISA mean score" without saying *which* mean. PISA reports
--    mathematics, reading and science separately. Averaging the three would be a composite --
--    permitted by Q223, which allows weights within one dimension and PISA's domains are
--    tracers of one school system -- but it would be **our** composite, and derived attributes
--    are deferred to the second pass (`devplan.md` 8). So a single published figure is taken:
--    **mathematics, the major domain of the 2022 cycle**.
--
-- `percentile` rather than `fixed`: the roster is 31 European countries assessed on one
-- instrument in one cycle, so what a score means *is* its standing among them, and anchoring it
-- absolutely would require inventing what 450 is worth (`reqs.md` Q5: percentile "where only
-- relative standing matters").
--
-- depends: 0477-career-weights-sum-exactly

-- **The criteria are lifted out and put back.** `criterion_matches_attribute_type` is a
-- composite foreign key on `(attribute, value_type)` and is not deferrable, so neither side can
-- change first: updating the attribute orphans the criteria, and updating the criteria points
-- them at a type the attribute does not yet have. The rows are captured, deleted, and restored
-- with their weights once the attribute has moved -- which is also why this is a migration and
-- not something a user could do from a screen.
CREATE TEMP TABLE lifted AS
SELECT criteria_set, attribute, pillar, is_scored, weight, weight_locked, goal,
       target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   criterion WHERE attribute = 'country.school_system_quality';

DELETE FROM criterion WHERE attribute = 'country.school_system_quality';

UPDATE attribute
SET    value_type = 'Quantity',
       description = 'OECD PISA mathematics mean score, the major domain of the 2022 cycle. Centred on 500 with a standard deviation of 100; a base, not a range'
WHERE  id = 'country.school_system_quality';

-- The unit vocabulary is a table, so a new unit is a row rather than a string nobody checks.
-- `ladder_points` set the precedent: a scale's own points, named after the instrument.
INSERT INTO unit (id, name)
VALUES ('pisa_points', 'PISA points (mean 500, standard deviation 100)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.school_system_quality', 'Quantity', 'pisa_points')
ON CONFLICT (attribute) DO UPDATE SET value_type = 'Quantity', unit = 'pisa_points';

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, target_range_min,
                       target_range_max, zero_score_below, zero_score_above, blocks_if_missing,
                       breakdown_option, reducer_mode)
SELECT criteria_set, attribute, pillar, 'Quantity', is_scored, weight, weight_locked, goal,
       'percentile', target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   lifted;

DROP TABLE lifted;

DO $$
DECLARE
    wrong integer;
BEGIN
    SELECT count(*) INTO wrong
    FROM   attribute a
    LEFT   JOIN attribute_quantity_parameter q ON q.attribute = a.id
    WHERE  a.id = 'country.school_system_quality'
      AND  (a.value_type <> 'Quantity' OR q.unit IS NULL);

    IF wrong <> 0 THEN
        RAISE EXCEPTION 'school_system_quality is still not a Quantity with a unit';
    END IF;

    SELECT count(*) INTO wrong FROM criterion
    WHERE  attribute = 'country.school_system_quality' AND normalisation_method = 'as_is';
    IF wrong <> 0 THEN
        RAISE EXCEPTION '% criteria still score PISA points as if they were a score', wrong;
    END IF;
END $$;
