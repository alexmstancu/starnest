-- Let a result float free of its evaluation's level, and a reason point at a live criterion.
--
-- The criterion column comes back nullable and unpopulated: every reason that named one named
-- it through the evaluation instead, and there is no way back from an attribute to the
-- criterion id it was copied from once the live criterion may have been edited or deleted --
-- which is the whole reason 0108 stopped storing it.

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_names_exactly_one_rule;

ALTER TABLE non_match_reason ADD COLUMN criterion bigint REFERENCES criterion (id);

ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_names_exactly_one_rule
        CHECK (num_nonnulls(criterion, match_rule, compound_rule) = 1);

ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_names_a_frozen_criterion;
ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_belongs_to_its_results_evaluation;
ALTER TABLE non_match_reason DROP COLUMN attribute;
ALTER TABLE non_match_reason DROP COLUMN evaluation;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_evaluation_key;

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_ranks_a_candidate_at_that_level;
ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_is_at_its_evaluations_level;
ALTER TABLE candidate_result DROP COLUMN level;

ALTER TABLE evaluation DROP CONSTRAINT evaluation_level_key;
