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

-- **Locked before it counts or copies** (BE-A1). A figure stored between the count and
-- the retype met a raw foreign-key error rather than this refusal, and a set edit committed
-- between the copy below and its delete was replaced by the older copy. SHARE ROW EXCLUSIVE
-- waits for writes in flight and holds off new ones until this commits, while reads go on.
LOCK TABLE value, criterion, criterion_scale_anchor, criterion_threshold_range
    IN SHARE ROW EXCLUSIVE MODE;

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

-- **Refuses while a person's anchors or matching threshold hang off the criterion** (P95).
-- They reference the criterion's id, which the lift below ends, and a Monetary criterion is
-- normalised by rules of its own, so they cannot simply be carried across. They met a raw
-- foreign-key error here before; now the refusal names the sets.
DO $$
DECLARE
    ruled integer;
    sets  text;
BEGIN
    SELECT count(DISTINCT judged.id), string_agg(DISTINCT judged.criteria_set, ', ')
    INTO   ruled, sets
    FROM   criterion AS judged
    LEFT JOIN criterion_scale_anchor AS anchor ON anchor.criterion = judged.id
    LEFT JOIN criterion_threshold_range AS threshold ON threshold.criterion = judged.id
    WHERE  judged.attribute = 'country.child_benefit_policy'
      AND  (anchor.criterion IS NOT NULL OR threshold.criterion IS NOT NULL);
    IF ruled > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0492: % criteria on country.child_benefit_policy carry '
            'scale anchors or a matching threshold (sets: %), which this rollback cannot '
            'carry across the type change. Remove them in Configure (Criteria) and roll back '
            'again, or restore from the backup make migrate took.', ruled, sets;
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
