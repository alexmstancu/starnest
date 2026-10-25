-- Undo 0519: a figure's payload and a composition's sum are again the writer's to keep.
--
-- Drops the triggers and functions 0519 added, and nothing else. Loosens and loses nothing -- no
-- row is written or removed -- so it never refuses.

DROP TRIGGER IF EXISTS value_sharecomp_sums_to_100 ON value_sharecomp;
DROP TRIGGER IF EXISTS value_text_leaves_its_figure_complete ON value_text;
DROP TRIGGER IF EXISTS value_score_leaves_its_figure_complete ON value_score;
DROP TRIGGER IF EXISTS value_boolean_leaves_its_figure_complete ON value_boolean;
DROP TRIGGER IF EXISTS value_sharecomp_leaves_its_figure_complete ON value_sharecomp;
DROP TRIGGER IF EXISTS value_labelset_leaves_its_figure_complete ON value_labelset;
DROP TRIGGER IF EXISTS value_index_leaves_its_figure_complete ON value_index;
DROP TRIGGER IF EXISTS value_ratio_leaves_its_figure_complete ON value_ratio;
DROP TRIGGER IF EXISTS value_count_leaves_its_figure_complete ON value_count;
DROP TRIGGER IF EXISTS value_quantity_leaves_its_figure_complete ON value_quantity;
DROP TRIGGER IF EXISTS value_monetary_leaves_its_figure_complete ON value_monetary;
DROP TRIGGER IF EXISTS value_is_complete ON value;

DROP FUNCTION IF EXISTS value_shares_sum_to_100();
DROP FUNCTION IF EXISTS value_is_complete();
DROP FUNCTION IF EXISTS value_carries_its_payload(bigint, text);
