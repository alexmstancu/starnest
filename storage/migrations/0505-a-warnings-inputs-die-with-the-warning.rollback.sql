-- Back to a foreign key that refuses the delete rather than following it.
--
-- **Restoring this reintroduces the boot-sweep hazard 0505 fixed**: a warning with a stored
-- input row becomes undeletable, so `sweep_test_evaluations` fails and the backend refuses to
-- start on any database that holds a test ranking with a frozen warning. Touches
-- `candidate_warning_input`, the table 0505 altered.

ALTER TABLE candidate_warning_input
    DROP CONSTRAINT candidate_warning_input_belongs_to_a_warning;

ALTER TABLE candidate_warning_input
    ADD CONSTRAINT candidate_warning_input_belongs_to_a_warning
        FOREIGN KEY (candidate_result, compound_rule)
        REFERENCES candidate_warning (candidate_result, compound_rule);
