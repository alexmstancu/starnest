-- Back to constraints that refuse a delete rather than following one.
--
-- **Restoring these makes an evaluation undeletable again**, which is the state the boot sweep
-- of test-made rows depends on not being in. Roll this back and that sweep starts failing.

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_candidate_result_fkey;
ALTER TABLE candidate_attribute_score ADD CONSTRAINT candidate_attribute_score_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id);

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_uses_its_results_scale;
ALTER TABLE candidate_attribute_score ADD CONSTRAINT candidate_attribute_score_uses_its_results_scale
    FOREIGN KEY (candidate_result, score_scale_max) REFERENCES candidate_result(id, score_scale_max);

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_evaluation_fkey;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_evaluation_fkey
    FOREIGN KEY (evaluation) REFERENCES evaluation(id);

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_is_at_its_evaluations_level;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_is_at_its_evaluations_level
    FOREIGN KEY (evaluation, level) REFERENCES evaluation(id, level);

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_uses_its_evaluations_scale;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_uses_its_evaluations_scale
    FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation(id, score_scale_max);

ALTER TABLE candidate_warning DROP CONSTRAINT candidate_warning_candidate_result_fkey;
ALTER TABLE candidate_warning ADD CONSTRAINT candidate_warning_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id);

ALTER TABLE evaluation_criterion DROP CONSTRAINT evaluation_criterion_evaluation_fkey;
ALTER TABLE evaluation_criterion ADD CONSTRAINT evaluation_criterion_evaluation_fkey
    FOREIGN KEY (evaluation) REFERENCES evaluation(id);

ALTER TABLE evaluation_scale_anchor DROP CONSTRAINT evaluation_scale_anchor_belongs_to_a_frozen_criterion;
ALTER TABLE evaluation_scale_anchor ADD CONSTRAINT evaluation_scale_anchor_belongs_to_a_frozen_criterion
    FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion(evaluation, attribute);

ALTER TABLE evaluation_scale_anchor DROP CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale;
ALTER TABLE evaluation_scale_anchor ADD CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale
    FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation(id, score_scale_max);

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_belongs_to_its_results_evaluation;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_belongs_to_its_results_evaluation
    FOREIGN KEY (candidate_result, evaluation) REFERENCES candidate_result(id, evaluation);

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_candidate_result_fkey;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id);

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_names_a_frozen_criterion;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_names_a_frozen_criterion
    FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion(evaluation, attribute);

