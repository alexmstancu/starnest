-- Back to the Monetary `EUR/month per child` declaration, which can hold no value at all.
--
-- **Refuses once figures are stored**, for the reason 0478's rollback does: a Monetary
-- attribute cannot hold the percentage figures this stored under `value_matches_attribute_type`
-- (a composite FK on `(attribute, value_type)`). Forcing it would mean deleting the figures,
-- and any saved evaluation that read them would be left explaining a score from values that
-- are gone. So it refuses with the remedy rather than failing with a raw FK error two
-- statements in. `make migrate` takes a backup first; restore from that instead.
--
-- On a database that has acquired nothing -- every fresh one, the test database included --
-- there are no such values, so the retype below runs and the path stays exercised.

DO $$
DECLARE
    stored integer;
BEGIN
    SELECT count(*) INTO stored
    FROM   value WHERE attribute = 'country.child_benefit_policy';
    IF stored > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0492: % figures are stored for country.child_benefit_policy, '
            'and the Monetary type this restores cannot hold a percentage. Restore from the '
            'backup make migrate took instead of forcing this.', stored;
    END IF;
END $$;

CREATE TEMP TABLE lifted AS
SELECT criteria_set, attribute, pillar, is_scored, weight, weight_locked, goal,
       target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   criterion WHERE attribute = 'country.child_benefit_policy';

DELETE FROM criterion WHERE attribute = 'country.child_benefit_policy';

-- Before the attribute moves: this row is keyed on `(attribute, value_type)` too.
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.child_benefit_policy';

UPDATE attribute SET value_type = 'Monetary', description = 'EUR/month per child'
WHERE  id = 'country.child_benefit_policy';

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, target_range_min,
                       target_range_max, zero_score_below, zero_score_above, blocks_if_missing,
                       breakdown_option, reducer_mode)
SELECT criteria_set, attribute, pillar, 'Monetary', is_scored, weight, weight_locked, goal,
       'fixed', target_range_min, target_range_max, zero_score_below, zero_score_above,
       blocks_if_missing, breakdown_option, reducer_mode
FROM   lifted;

DROP TABLE lifted;

-- The unit this added, removed only if nothing else now names it.
DELETE FROM unit
WHERE  id = 'pct_of_average_wage'
  AND  NOT EXISTS (SELECT 1 FROM attribute_quantity_parameter q WHERE q.unit = 'pct_of_average_wage');
