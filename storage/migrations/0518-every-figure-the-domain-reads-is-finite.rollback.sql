-- Undo 0518: the three checks named "finite" go back to refusing NaN alone, and the others go.
--
-- Loosens and loses nothing -- no row is written or removed -- so it never refuses. It alters
-- every table 0518 altered, and locks them all first for the same reason 0518 does.

LOCK TABLE value_monetary,
           value_quantity,
           value_index,
           value_score,
           fx_rate,
           external_score,
           household,
           settings,
           data_acquisition_run,
           match_rule_research_spend,
           attribute_allowed_range,
           attribute_index_parameter,
           criterion,
           criterion_scale_anchor,
           criterion_threshold_range,
           compound_rule,
           compound_rule_condition,
           evaluation_criterion,
           evaluation_scale_anchor,
           candidate_attribute_score
           IN ACCESS EXCLUSIVE MODE;

ALTER TABLE value_monetary
    DROP CONSTRAINT IF EXISTS value_monetary_amount_is_finite,
    DROP CONSTRAINT IF EXISTS value_monetary_eur_is_finite,
    DROP CONSTRAINT IF EXISTS value_monetary_fx_rate_is_finite,
    ADD CONSTRAINT value_monetary_amount_is_finite
        CHECK (amount <> 'NaN'::numeric),
    ADD CONSTRAINT value_monetary_eur_is_finite
        CHECK (amount_eur <> 'NaN'::numeric);

ALTER TABLE value_quantity
    DROP CONSTRAINT IF EXISTS value_quantity_magnitude_is_finite,
    ADD CONSTRAINT value_quantity_magnitude_is_finite
        CHECK (magnitude <> 'NaN'::numeric);

ALTER TABLE value_index
    DROP CONSTRAINT IF EXISTS value_index_value_is_finite,
    DROP CONSTRAINT IF EXISTS value_index_scale_min_is_finite,
    DROP CONSTRAINT IF EXISTS value_index_scale_max_is_finite;

ALTER TABLE value_score
    DROP CONSTRAINT IF EXISTS value_score_value_is_finite,
    DROP CONSTRAINT IF EXISTS value_score_range_min_is_finite,
    DROP CONSTRAINT IF EXISTS value_score_range_max_is_finite;

ALTER TABLE fx_rate
    DROP CONSTRAINT IF EXISTS fx_rate_rate_is_finite;

ALTER TABLE external_score
    DROP CONSTRAINT IF EXISTS external_score_published_value_is_finite;

ALTER TABLE household
    DROP CONSTRAINT IF EXISTS household_net_income_is_finite,
    DROP CONSTRAINT IF EXISTS household_target_monthly_spend_is_finite,
    DROP CONSTRAINT IF EXISTS household_max_rent_is_finite;

ALTER TABLE settings
    DROP CONSTRAINT IF EXISTS settings_run_spend_cap_eur_is_finite;

ALTER TABLE data_acquisition_run
    DROP CONSTRAINT IF EXISTS data_acquisition_run_cost_eur_is_finite;

ALTER TABLE match_rule_research_spend
    DROP CONSTRAINT IF EXISTS match_rule_research_spend_cost_eur_is_finite;

ALTER TABLE attribute_allowed_range
    DROP CONSTRAINT IF EXISTS attribute_allowed_range_min_value_is_finite,
    DROP CONSTRAINT IF EXISTS attribute_allowed_range_max_value_is_finite;

ALTER TABLE attribute_index_parameter
    DROP CONSTRAINT IF EXISTS attribute_index_parameter_scale_min_is_finite,
    DROP CONSTRAINT IF EXISTS attribute_index_parameter_scale_max_is_finite;

ALTER TABLE criterion
    DROP CONSTRAINT IF EXISTS criterion_target_range_min_is_finite,
    DROP CONSTRAINT IF EXISTS criterion_target_range_max_is_finite,
    DROP CONSTRAINT IF EXISTS criterion_zero_score_below_is_finite,
    DROP CONSTRAINT IF EXISTS criterion_zero_score_above_is_finite;

ALTER TABLE criterion_scale_anchor
    DROP CONSTRAINT IF EXISTS criterion_scale_anchor_input_value_is_finite;

ALTER TABLE criterion_threshold_range
    DROP CONSTRAINT IF EXISTS criterion_threshold_range_min_value_is_finite,
    DROP CONSTRAINT IF EXISTS criterion_threshold_range_max_value_is_finite;

ALTER TABLE compound_rule
    DROP CONSTRAINT IF EXISTS compound_rule_threshold_min_is_finite,
    DROP CONSTRAINT IF EXISTS compound_rule_threshold_max_is_finite;

ALTER TABLE compound_rule_condition
    DROP CONSTRAINT IF EXISTS compound_rule_condition_threshold_min_is_finite,
    DROP CONSTRAINT IF EXISTS compound_rule_condition_threshold_max_is_finite;

ALTER TABLE evaluation_criterion
    DROP CONSTRAINT IF EXISTS evaluation_criterion_target_range_min_is_finite,
    DROP CONSTRAINT IF EXISTS evaluation_criterion_target_range_max_is_finite,
    DROP CONSTRAINT IF EXISTS evaluation_criterion_zero_score_below_is_finite,
    DROP CONSTRAINT IF EXISTS evaluation_criterion_zero_score_above_is_finite;

ALTER TABLE evaluation_scale_anchor
    DROP CONSTRAINT IF EXISTS evaluation_scale_anchor_input_value_is_finite;

ALTER TABLE candidate_attribute_score
    DROP CONSTRAINT IF EXISTS candidate_attribute_score_contribution_is_finite;
