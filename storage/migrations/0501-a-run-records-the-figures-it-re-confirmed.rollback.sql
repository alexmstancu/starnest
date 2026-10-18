-- Drop the reuse table, returning the accounting to counting a re-confirmed transcribed figure
-- as unanswered. Touches `data_acquisition_run_reuse`, the table the forward step created.

DROP TABLE IF EXISTS data_acquisition_run_reuse;
