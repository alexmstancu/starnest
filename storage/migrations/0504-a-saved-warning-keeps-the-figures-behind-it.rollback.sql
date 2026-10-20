-- Drop the warning-input table, returning a saved warning to text without its source chain.
-- Touches `candidate_warning_input`, the table the forward step created.

DROP TABLE IF EXISTS candidate_warning_input;
