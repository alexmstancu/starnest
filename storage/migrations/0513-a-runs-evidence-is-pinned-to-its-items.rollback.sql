-- Undo 0513: a run's evidence, items and scope lose the keys that pinned them, and the scope
-- lists lose the level they copied from the run. The level is derived from the run and can be
-- derived again, so nothing a run recorded is lost and nothing needs refusing.
--
-- **Locked first** (BE-A1), as the forward step locked them.
LOCK TABLE data_acquisition_run,
           data_acquisition_run_candidate,
           data_acquisition_run_attribute,
           data_acquisition_run_item,
           data_acquisition_failure,
           data_acquisition_run_reuse,
           value
    IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE data_acquisition_run_reuse
    DROP CONSTRAINT IF EXISTS data_acquisition_run_reuse_is_one_of_its_run_s_items;
ALTER TABLE data_acquisition_failure
    DROP CONSTRAINT IF EXISTS data_acquisition_failure_is_one_of_its_run_s_items;
ALTER TABLE value
    DROP CONSTRAINT IF EXISTS value_is_one_of_its_run_s_items;
ALTER TABLE data_acquisition_run_item
    DROP CONSTRAINT IF EXISTS data_acquisition_run_item_attribute_is_in_scope,
    DROP CONSTRAINT IF EXISTS data_acquisition_run_item_candidate_is_in_scope;
ALTER TABLE data_acquisition_run_attribute
    DROP CONSTRAINT IF EXISTS data_acquisition_run_attribute_sits_at_its_level,
    DROP CONSTRAINT IF EXISTS data_acquisition_run_attribute_is_at_its_run_s_level,
    DROP COLUMN IF EXISTS level;
ALTER TABLE data_acquisition_run_candidate
    DROP CONSTRAINT IF EXISTS data_acquisition_run_candidate_sits_at_its_level,
    DROP CONSTRAINT IF EXISTS data_acquisition_run_candidate_is_at_its_run_s_level,
    DROP COLUMN IF EXISTS level;
ALTER TABLE data_acquisition_run
    DROP CONSTRAINT IF EXISTS data_acquisition_run_level_key;
