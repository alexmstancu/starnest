-- Allow a half-recorded reference period again. Rows already stored satisfy the check, so
-- nothing is rewritten and nothing is lost.

ALTER TABLE match_rule_result
    DROP CONSTRAINT match_rule_result_reference_period_is_all_or_nothing;
