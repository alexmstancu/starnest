-- `country.projected_summer_heat_days` is scored `percentile`, not `fixed`.
--
-- The shipped sets scored it `fixed` with no scale anchors, which reads a figure as already being
-- out of the scale and so scores a silent zero for every candidate -- the fault `0443`
-- (cost_of_living), `0488` (housing) and `0492` (child_benefit) each fixed. It did no harm while
-- no source answered the attribute; the Copernicus adapter now does, so the figures would arrive
-- and score nothing. `tests/storage/test_catalog_arithmetic.py` caught exactly this the moment the
-- adapter declared the attribute.
--
-- **`percentile`, because the meaning is standing.** What a projected hot-day count is worth for
-- livability is where it sits among the 32 European options, not an absolute line -- and anchoring
-- it absolutely would mean inventing how many hot days scores zero, the invented number `0478`
-- and `0492` both refused. `goal = minimise` is unchanged: fewer hot days is better.
-- depends: 0494-the-liechtenstein-quota-gate-is-armed

UPDATE criterion
SET    normalisation_method = 'percentile'
WHERE  attribute = 'country.projected_summer_heat_days'
  AND  normalisation_method = 'fixed';

DO $$
DECLARE
    still_fixed integer;
BEGIN
    SELECT count(*) INTO still_fixed
    FROM   criterion
    WHERE  attribute = 'country.projected_summer_heat_days'
      AND  normalisation_method <> 'percentile';
    IF still_fixed <> 0 THEN
        RAISE EXCEPTION 'projected_summer_heat_days still has % non-percentile criteria', still_fixed;
    END IF;
END $$;
