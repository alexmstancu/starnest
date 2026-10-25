-- Undo 0523: a saved ranking's evidence and frozen set lose the keys that pinned them to their
-- own candidate and level, and the columns those keys read. Every column dropped is a copy --
-- of the result's evaluation and candidate, of the evaluation's level, of a rule's catalog
-- level -- and can be derived again, so nothing a ranking kept is lost and nothing needs
-- refusing. It only loosens.
--
-- **Locked first** (BE-A1), as the forward step locked them, in the order a save writes them.
LOCK TABLE evaluation,
           evaluation_criterion,
           evaluation_match_rule,
           evaluation_compound_rule,
           candidate_result,
           candidate_attribute_score,
           non_match_reason,
           candidate_gate_warning,
           candidate_warning_input,
           non_match_input,
           value,
           attribute,
           match_rule,
           compound_rule,
           match_rule_answer
    IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE non_match_input
    DROP CONSTRAINT IF EXISTS non_match_input_belongs_to_a_refusal,
    DROP CONSTRAINT IF EXISTS non_match_input_cites_its_own_candidate_s_figure,
    DROP CONSTRAINT IF EXISTS non_match_input_is_of_its_results_candidate,
    DROP COLUMN IF EXISTS candidate;
ALTER TABLE candidate_warning_input
    DROP CONSTRAINT IF EXISTS candidate_warning_input_cites_its_own_candidate_s_figure,
    DROP CONSTRAINT IF EXISTS candidate_warning_input_is_of_its_results_candidate,
    DROP COLUMN IF EXISTS candidate;
ALTER TABLE candidate_gate_warning
    DROP CONSTRAINT IF EXISTS candidate_gate_warning_cites_its_own_candidate_s_answer,
    DROP CONSTRAINT IF EXISTS candidate_gate_warning_is_of_its_results_candidate,
    DROP COLUMN IF EXISTS candidate;
ALTER TABLE non_match_reason
    DROP CONSTRAINT IF EXISTS non_match_reason_cites_its_own_candidate_s_answer,
    DROP CONSTRAINT IF EXISTS non_match_reason_cites_its_own_measurement,
    DROP CONSTRAINT IF EXISTS non_match_reason_is_of_its_results_candidate,
    DROP COLUMN IF EXISTS candidate;
ALTER TABLE candidate_attribute_score
    DROP CONSTRAINT IF EXISTS candidate_attribute_score_cites_its_own_measurement,
    DROP CONSTRAINT IF EXISTS candidate_attribute_score_names_a_frozen_criterion,
    DROP CONSTRAINT IF EXISTS candidate_attribute_score_is_of_its_results_candidate,
    DROP CONSTRAINT IF EXISTS candidate_attribute_score_is_of_its_results_evaluation,
    DROP COLUMN IF EXISTS candidate,
    DROP COLUMN IF EXISTS evaluation;
ALTER TABLE evaluation_compound_rule
    DROP CONSTRAINT IF EXISTS evaluation_compound_rule_is_a_rule_at_that_level,
    DROP CONSTRAINT IF EXISTS evaluation_compound_rule_is_at_its_evaluations_level,
    DROP COLUMN IF EXISTS level;
ALTER TABLE evaluation_match_rule
    DROP CONSTRAINT IF EXISTS evaluation_match_rule_is_a_gate_at_that_level,
    DROP CONSTRAINT IF EXISTS evaluation_match_rule_is_at_its_evaluations_level,
    DROP COLUMN IF EXISTS level;
ALTER TABLE evaluation_criterion
    DROP CONSTRAINT IF EXISTS evaluation_criterion_judges_an_attribute_at_that_level,
    DROP CONSTRAINT IF EXISTS evaluation_criterion_is_at_its_evaluations_level,
    DROP COLUMN IF EXISTS level;

ALTER TABLE compound_rule
    DROP CONSTRAINT IF EXISTS compound_rule_level_key;
ALTER TABLE non_match_reason
    DROP CONSTRAINT IF EXISTS non_match_reason_one_per_compound_rule;
ALTER TABLE candidate_result
    DROP CONSTRAINT IF EXISTS candidate_result_candidate_key;
ALTER TABLE value
    DROP CONSTRAINT IF EXISTS value_candidate_key,
    DROP CONSTRAINT IF EXISTS value_candidate_attribute_key;
