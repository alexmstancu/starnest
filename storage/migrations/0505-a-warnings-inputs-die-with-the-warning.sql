-- A saved warning's input figures die with the warning (ST-07, repairing 0504).
--
-- depends: 0504-a-saved-warning-keeps-the-figures-behind-it
--
-- 0504 hung `candidate_warning_input` off `candidate_warning` with a plain foreign key. That
-- made a warning undeletable while any input row referenced it -- and the boot sweep of the
-- rankings a test saved (`main.py`, `sweep_test_evaluations`) deletes warnings, so it began to
-- fail and the backend refused to start. `TRUNCATE CASCADE` in the storage tests and the
-- throwaway database `make e2e` builds both hid it.
--
-- `0482` settled the rule this restores: an evaluation's children die with it in the schema,
-- never by a hand-ordered delete in the query file, because a forgotten table fails at the one
-- moment nobody is watching -- a boot sweep. A warning's inputs are such children, so the key
-- carries `ON DELETE CASCADE`. The foreign key to `value (id)` is deliberately left refusing:
-- the sweep never deletes a value, and a value is not a child of the warning that read it.

ALTER TABLE candidate_warning_input
    DROP CONSTRAINT candidate_warning_input_belongs_to_a_warning;

ALTER TABLE candidate_warning_input
    ADD CONSTRAINT candidate_warning_input_belongs_to_a_warning
        FOREIGN KEY (candidate_result, compound_rule)
        REFERENCES candidate_warning (candidate_result, compound_rule)
        ON DELETE CASCADE;
