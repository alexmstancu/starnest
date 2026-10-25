-- Every number the domain reads is finite, in the database as well as in Python (PL-167: ST-16,
-- IN-NAN; decision D61).
--
-- depends: 0515-every-gate-says-what-it-tests
--
-- **Three checks named "finite" tested only for NaN** (`0006`), and PostgreSQL has stored
-- +Infinity and -Infinity in `numeric` since version 14 -- so each passed both infinities. **The
-- other numeric columns were worse**: PostgreSQL sorts NaN above every number, so `NaN >= 0` and
-- `NaN > 0` are true, and a sign or order check (`rate > 0`, `scale_min < scale_max`) admits NaN,
-- +Infinity, or a scale running from -Infinity to +Infinity. The domain refuses all three on read
-- (`allow_inf_nan=False` on every Decimal), so a non-finite figure written by any other route --
-- `psql`, a restore, a second client -- made every screen that reads it answer 500.
--
-- So every numeric column the domain reads now carries one check, `<table>_<column>_is_finite`,
-- refusing NaN and both infinities. The three old names are kept and rewritten, `amount_eur`'s
-- included (`value_monetary_eur_is_finite`). **Columns already bounded on both sides are left
-- alone**: `x >= 0 AND x <= 100` refuses NaN (NaN <= 100 is false) and both infinities, so a
-- second check would only restate it. `test_finite_figures_behaviour` holds every numeric column
-- to one or the other, and names each exemption with the check that covers it.
--
-- **A stored non-finite figure stops the migration and is named**, by table, column and row --
-- never coerced to a number: which figure was meant is not this migration's to decide. Correct
-- or delete the rows named, then migrate again.

-- **Locked first, and exclusively** (BE-A1): a write committed between the check and the
-- constraint would meet a raw check violation rather than the refusal below. ACCESS EXCLUSIVE,
-- not SHARE ROW EXCLUSIVE, because every one of these tables is then altered, which takes it
-- anyway: upgrading a lock while a reader that means to write holds its own is a deadlock.
-- Validation reads a few thousand rows, so reads are held for milliseconds; migrate while idle.
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

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(offender, '; ' ORDER BY offender) INTO offenders
    FROM (
        SELECT format('value_monetary.amount (value %s)', value_id)
        FROM value_monetary WHERE amount IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_monetary.amount_eur (value %s)', value_id)
        FROM value_monetary WHERE amount_eur IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_monetary.fx_rate (value %s)', value_id)
        FROM value_monetary WHERE fx_rate IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_quantity.magnitude (value %s)', value_id)
        FROM value_quantity WHERE magnitude IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_index.value (value %s)', value_id)
        FROM value_index WHERE value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_index.scale_min (value %s)', value_id)
        FROM value_index WHERE scale_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_index.scale_max (value %s)', value_id)
        FROM value_index WHERE scale_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_score.value (value %s)', value_id)
        FROM value_score WHERE value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_score.range_min (value %s)', value_id)
        FROM value_score WHERE range_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('value_score.range_max (value %s)', value_id)
        FROM value_score WHERE range_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('fx_rate.rate (%s/%s on %s)', base_currency, quote_currency, rate_date)
        FROM fx_rate WHERE rate IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('external_score.published_value (id %s)', id)
        FROM external_score WHERE published_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('household.net_income (id %s)', id)
        FROM household WHERE net_income IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('household.target_monthly_spend (id %s)', id)
        FROM household WHERE target_monthly_spend IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('household.max_rent (id %s)', id)
        FROM household WHERE max_rent IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('settings.run_spend_cap_eur (id %s)', id)
        FROM settings WHERE run_spend_cap_eur IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('data_acquisition_run.cost_eur (run %s)', id)
        FROM data_acquisition_run WHERE cost_eur IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('match_rule_research_spend.cost_eur (id %s)', id)
        FROM match_rule_research_spend WHERE cost_eur IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('attribute_allowed_range.min_value (attribute %s)', attribute)
        FROM attribute_allowed_range WHERE min_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('attribute_allowed_range.max_value (attribute %s)', attribute)
        FROM attribute_allowed_range WHERE max_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('attribute_index_parameter.scale_min (attribute %s)', attribute)
        FROM attribute_index_parameter WHERE scale_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('attribute_index_parameter.scale_max (attribute %s)', attribute)
        FROM attribute_index_parameter WHERE scale_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion.target_range_min (criterion %s)', id)
        FROM criterion WHERE target_range_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion.target_range_max (criterion %s)', id)
        FROM criterion WHERE target_range_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion.zero_score_below (criterion %s)', id)
        FROM criterion WHERE zero_score_below IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion.zero_score_above (criterion %s)', id)
        FROM criterion WHERE zero_score_above IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion_scale_anchor.input_value (criterion %s)', criterion)
        FROM criterion_scale_anchor WHERE input_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion_threshold_range.min_value (criterion %s)', criterion)
        FROM criterion_threshold_range WHERE min_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('criterion_threshold_range.max_value (criterion %s)', criterion)
        FROM criterion_threshold_range WHERE max_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('compound_rule.threshold_min (rule %s)', id)
        FROM compound_rule WHERE threshold_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('compound_rule.threshold_max (rule %s)', id)
        FROM compound_rule WHERE threshold_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('compound_rule_condition.threshold_min (rule %s condition %s)', compound_rule, ordinal)
        FROM compound_rule_condition WHERE threshold_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('compound_rule_condition.threshold_max (rule %s condition %s)', compound_rule, ordinal)
        FROM compound_rule_condition WHERE threshold_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('evaluation_criterion.target_range_min (evaluation %s, %s)', evaluation, attribute)
        FROM evaluation_criterion WHERE target_range_min IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('evaluation_criterion.target_range_max (evaluation %s, %s)', evaluation, attribute)
        FROM evaluation_criterion WHERE target_range_max IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('evaluation_criterion.zero_score_below (evaluation %s, %s)', evaluation, attribute)
        FROM evaluation_criterion WHERE zero_score_below IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('evaluation_criterion.zero_score_above (evaluation %s, %s)', evaluation, attribute)
        FROM evaluation_criterion WHERE zero_score_above IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('evaluation_scale_anchor.input_value (evaluation %s, %s)', evaluation, attribute)
        FROM evaluation_scale_anchor WHERE input_value IN ('NaN', 'Infinity', '-Infinity')
        UNION ALL
        SELECT format('candidate_attribute_score.contribution (result %s, %s)', candidate_result, attribute)
        FROM candidate_attribute_score WHERE contribution IN ('NaN', 'Infinity', '-Infinity')
    ) AS non_finite (offender);
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0518: these stored figures are NaN or infinite, and nothing here can '
            'choose the number that was meant: %. Correct or delete each, then migrate again. '
            'Nothing was changed.', offenders;
    END IF;
END $$;

ALTER TABLE value_monetary
    DROP CONSTRAINT value_monetary_amount_is_finite,
    DROP CONSTRAINT value_monetary_eur_is_finite,
    ADD CONSTRAINT value_monetary_amount_is_finite
        CHECK (amount NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_monetary_eur_is_finite
        CHECK (amount_eur NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_monetary_fx_rate_is_finite
        CHECK (fx_rate NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE value_quantity
    DROP CONSTRAINT value_quantity_magnitude_is_finite,
    ADD CONSTRAINT value_quantity_magnitude_is_finite
        CHECK (magnitude NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE value_index
    ADD CONSTRAINT value_index_value_is_finite
        CHECK (value NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_index_scale_min_is_finite
        CHECK (scale_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_index_scale_max_is_finite
        CHECK (scale_max NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE value_score
    ADD CONSTRAINT value_score_value_is_finite
        CHECK (value NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_score_range_min_is_finite
        CHECK (range_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT value_score_range_max_is_finite
        CHECK (range_max NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE fx_rate
    ADD CONSTRAINT fx_rate_rate_is_finite
        CHECK (rate NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE external_score
    ADD CONSTRAINT external_score_published_value_is_finite
        CHECK (published_value NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE household
    ADD CONSTRAINT household_net_income_is_finite
        CHECK (net_income NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT household_target_monthly_spend_is_finite
        CHECK (target_monthly_spend NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT household_max_rent_is_finite
        CHECK (max_rent NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE settings
    ADD CONSTRAINT settings_run_spend_cap_eur_is_finite
        CHECK (run_spend_cap_eur NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_cost_eur_is_finite
        CHECK (cost_eur NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE match_rule_research_spend
    ADD CONSTRAINT match_rule_research_spend_cost_eur_is_finite
        CHECK (cost_eur NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE attribute_allowed_range
    ADD CONSTRAINT attribute_allowed_range_min_value_is_finite
        CHECK (min_value NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT attribute_allowed_range_max_value_is_finite
        CHECK (max_value NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE attribute_index_parameter
    ADD CONSTRAINT attribute_index_parameter_scale_min_is_finite
        CHECK (scale_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT attribute_index_parameter_scale_max_is_finite
        CHECK (scale_max NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE criterion
    ADD CONSTRAINT criterion_target_range_min_is_finite
        CHECK (target_range_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT criterion_target_range_max_is_finite
        CHECK (target_range_max NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT criterion_zero_score_below_is_finite
        CHECK (zero_score_below NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT criterion_zero_score_above_is_finite
        CHECK (zero_score_above NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE criterion_scale_anchor
    ADD CONSTRAINT criterion_scale_anchor_input_value_is_finite
        CHECK (input_value NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE criterion_threshold_range
    ADD CONSTRAINT criterion_threshold_range_min_value_is_finite
        CHECK (min_value NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT criterion_threshold_range_max_value_is_finite
        CHECK (max_value NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE compound_rule
    ADD CONSTRAINT compound_rule_threshold_min_is_finite
        CHECK (threshold_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT compound_rule_threshold_max_is_finite
        CHECK (threshold_max NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE compound_rule_condition
    ADD CONSTRAINT compound_rule_condition_threshold_min_is_finite
        CHECK (threshold_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT compound_rule_condition_threshold_max_is_finite
        CHECK (threshold_max NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE evaluation_criterion
    ADD CONSTRAINT evaluation_criterion_target_range_min_is_finite
        CHECK (target_range_min NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT evaluation_criterion_target_range_max_is_finite
        CHECK (target_range_max NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT evaluation_criterion_zero_score_below_is_finite
        CHECK (zero_score_below NOT IN ('NaN', 'Infinity', '-Infinity')),
    ADD CONSTRAINT evaluation_criterion_zero_score_above_is_finite
        CHECK (zero_score_above NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE evaluation_scale_anchor
    ADD CONSTRAINT evaluation_scale_anchor_input_value_is_finite
        CHECK (input_value NOT IN ('NaN', 'Infinity', '-Infinity'));

ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_contribution_is_finite
        CHECK (contribution NOT IN ('NaN', 'Infinity', '-Infinity'));
