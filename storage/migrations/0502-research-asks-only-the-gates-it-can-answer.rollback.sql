-- Undo `0502`: drop the table of the candidates a gate concerns, and the column saying whether a
-- model may research it. Both hold catalog facts the forward step seeded and can seed again, so
-- nothing a person recorded is lost here.

DROP TABLE IF EXISTS match_rule_candidate;

ALTER TABLE match_rule
    DROP COLUMN IF EXISTS researchable;
