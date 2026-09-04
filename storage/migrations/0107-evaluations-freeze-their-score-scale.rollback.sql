-- Unfreeze the scale, and let a score leave it again.
--
-- The four scale columns go with the checks that needed them: without a ceiling to compare
-- against, a copy of score_scale_max has nothing left to do. The floor-only checks are restored
-- under their original names so a re-application of 0107 finds the schema it expects.

ALTER TABLE candidate_attribute_score
    DROP CONSTRAINT candidate_attribute_score_weight_is_a_percentage;
ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_weight_is_not_negative CHECK (effective_weight >= 0);

ALTER TABLE evaluation_criterion DROP CONSTRAINT evaluation_criterion_weights_are_percentages;
ALTER TABLE evaluation_criterion
    ADD CONSTRAINT evaluation_criterion_weights_are_not_negative
        CHECK (weight >= 0 AND pillar_weight >= 0);

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_coverage_is_a_percentage;
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_coverage_is_not_negative CHECK (coverage >= 0);

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_is_on_the_scale;
ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_is_not_negative
        CHECK (normalised_score IS NULL OR normalised_score >= 0);
ALTER TABLE candidate_attribute_score
    DROP CONSTRAINT candidate_attribute_score_uses_its_results_scale;
ALTER TABLE candidate_attribute_score DROP COLUMN score_scale_max;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_score_is_on_the_scale;
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_score_is_not_negative CHECK (score IS NULL OR score >= 0);
ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_scale_key;
ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_uses_its_evaluations_scale;
ALTER TABLE candidate_result DROP COLUMN score_scale_max;

ALTER TABLE evaluation_scale_anchor DROP CONSTRAINT evaluation_scale_anchor_score_is_on_the_scale;
ALTER TABLE evaluation_scale_anchor
    ADD CONSTRAINT evaluation_scale_anchor_score_is_not_negative CHECK (score >= 0);
ALTER TABLE evaluation_scale_anchor
    DROP CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale;
ALTER TABLE evaluation_scale_anchor DROP COLUMN score_scale_max;

ALTER TABLE evaluation DROP CONSTRAINT evaluation_scale_key;
ALTER TABLE evaluation DROP CONSTRAINT evaluation_score_scale_is_positive;
ALTER TABLE evaluation DROP COLUMN score_scale_max;
