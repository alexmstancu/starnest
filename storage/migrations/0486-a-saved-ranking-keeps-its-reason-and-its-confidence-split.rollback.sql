-- Back to a saved ranking that cannot say how confident it was or why it refused.

-- **Refuses once a saved result has recorded its confidence or its reason** (TL-N2, D70).
-- That is recorded history, and a rollback that dropped it would change what the record says
-- without anyone choosing to. On a database that holds none -- every fresh one, the test
-- database included -- this runs, keeping the path exercised.
--
-- **Locked before it counts** (D70, following 0503 and 0507): a row committed between the count
-- and the drop would escape the refusal. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE candidate_result IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    explained integer;
BEGIN
    SELECT count(*) INTO explained
    FROM   candidate_result
    WHERE  insufficient_reason IS NOT NULL OR coverage_absolute IS NOT NULL
       OR  coverage_high IS NOT NULL OR coverage_medium IS NOT NULL OR coverage_low IS NOT NULL;
    IF explained > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0486: % saved result(s) record their confidence split or the '
            'reason they could not be scored, and this drops those columns. A saved evaluation '
            'must still explain its score (0107), so restore from the backup make migrate took '
            'instead of forcing this.', explained;
    END IF;
END $$;

ALTER TABLE candidate_result
    DROP CONSTRAINT candidate_result_explains_only_what_it_could_not_score;
ALTER TABLE candidate_result
    DROP CONSTRAINT candidate_result_confidence_shares_are_percentages;
ALTER TABLE candidate_result
    DROP COLUMN insufficient_reason,
    DROP COLUMN coverage_low,
    DROP COLUMN coverage_medium,
    DROP COLUMN coverage_high,
    DROP COLUMN coverage_absolute;
