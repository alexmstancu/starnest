-- An evaluation's snapshot dies with the evaluation.
--
-- **Nothing here makes a saved evaluation easier to lose.** There is still no
-- `DELETE /evaluations`, deliberately: a saved evaluation is a measurement somebody chose to
-- keep, and the protection is the absent operation rather than a missing CASCADE. What this
-- fixes is that a delete was not merely refused at the API -- it was impossible at all, so the
-- browser suite could not clean up after itself and left one row per run for ever.
--
-- **Why the schema rather than an ordered delete in the query file.** Six child tables hang
-- off an evaluation through twelve foreign keys. A hand-ordered delete would be correct until
-- somebody adds a seventh table and forgets, and it would then fail at the exact moment
-- nobody is watching -- a boot sweep. The rule "these rows have no life without their parent"
-- is a statement about the model, so it belongs in the model.
--
-- Every constraint below is re-added with the definition PostgreSQL itself reported for it,
-- plus `ON DELETE CASCADE`. Nothing else about any of them changes: the composite keys that
-- `0107` and `0108` added to stop a result drifting from its evaluation's level and scale are
-- reproduced exactly.
-- depends: 0481-a-refetch-age

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_candidate_result_fkey;
ALTER TABLE candidate_attribute_score ADD CONSTRAINT candidate_attribute_score_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id) ON DELETE CASCADE;

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_uses_its_results_scale;
ALTER TABLE candidate_attribute_score ADD CONSTRAINT candidate_attribute_score_uses_its_results_scale
    FOREIGN KEY (candidate_result, score_scale_max) REFERENCES candidate_result(id, score_scale_max) ON DELETE CASCADE;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_evaluation_fkey;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_evaluation_fkey
    FOREIGN KEY (evaluation) REFERENCES evaluation(id) ON DELETE CASCADE;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_is_at_its_evaluations_level;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_is_at_its_evaluations_level
    FOREIGN KEY (evaluation, level) REFERENCES evaluation(id, level) ON DELETE CASCADE;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_uses_its_evaluations_scale;
ALTER TABLE candidate_result ADD CONSTRAINT candidate_result_uses_its_evaluations_scale
    FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation(id, score_scale_max) ON DELETE CASCADE;

ALTER TABLE candidate_warning DROP CONSTRAINT candidate_warning_candidate_result_fkey;
ALTER TABLE candidate_warning ADD CONSTRAINT candidate_warning_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id) ON DELETE CASCADE;

ALTER TABLE evaluation_criterion DROP CONSTRAINT evaluation_criterion_evaluation_fkey;
ALTER TABLE evaluation_criterion ADD CONSTRAINT evaluation_criterion_evaluation_fkey
    FOREIGN KEY (evaluation) REFERENCES evaluation(id) ON DELETE CASCADE;

ALTER TABLE evaluation_scale_anchor DROP CONSTRAINT evaluation_scale_anchor_belongs_to_a_frozen_criterion;
ALTER TABLE evaluation_scale_anchor ADD CONSTRAINT evaluation_scale_anchor_belongs_to_a_frozen_criterion
    FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion(evaluation, attribute) ON DELETE CASCADE;

ALTER TABLE evaluation_scale_anchor DROP CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale;
ALTER TABLE evaluation_scale_anchor ADD CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale
    FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation(id, score_scale_max) ON DELETE CASCADE;

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_belongs_to_its_results_evaluation;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_belongs_to_its_results_evaluation
    FOREIGN KEY (candidate_result, evaluation) REFERENCES candidate_result(id, evaluation) ON DELETE CASCADE;

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_candidate_result_fkey;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_candidate_result_fkey
    FOREIGN KEY (candidate_result) REFERENCES candidate_result(id) ON DELETE CASCADE;

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_names_a_frozen_criterion;
ALTER TABLE non_match_reason ADD CONSTRAINT non_match_reason_names_a_frozen_criterion
    FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion(evaluation, attribute) ON DELETE CASCADE;

