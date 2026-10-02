-- Back to a saved ranking that cannot say how confident it was or why it refused.
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
