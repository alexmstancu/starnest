-- Drop the per-run item table, returning a run's item count to the rectangle of its two scope
-- lists. Touches `data_acquisition_run_item`, the table the forward step created. A retry's
-- phantom `unanswered` corners (BE-11) come back with it.

DROP TABLE IF EXISTS data_acquisition_run_item;
