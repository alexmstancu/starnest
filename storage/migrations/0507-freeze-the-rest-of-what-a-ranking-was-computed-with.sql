-- Freeze the rest of what a ranking was computed with (ST-07).
--
-- depends: 0506-a-run-records-the-exact-pairs-it-asked-about
--
-- A saved evaluation froze the criteria, the weights, the typed thresholds and a warning's
-- input figures, but three things it was computed with still read live or not at all, so a
-- reopened ranking could disagree with the one that was saved:
--
--   1. the **pillar-level lock** -- `weight_locked` was frozen per criterion but not per
--      pillar, so a reopened set showed every pillar unlocked;
--   2. **which rules the reading enforced and applied** -- the gates and compound rules a set
--      turns on were not recorded, so a reopened set claimed none;
--   3. the **input figures behind a `not_matching` compound rule** -- a warning froze its
--      inputs (0504) but the rule that ruled a candidate *out* kept none, so its source/date
--      chain could not be reopened; and a warning's inputs had no order, so they came back in
--      whatever order the read happened to return.
--
-- Each new table hangs off a row the boot sweep of test rankings already deletes
-- (`evaluation` or `candidate_result`), so each carries ON DELETE CASCADE -- the 0482 rule, and
-- the one 0504 forgot. The existing `delete_evaluation` sweeps them through that cascade.

-- 1. The pillar-level lock, frozen per criterion beside the pillar weight it already freezes.
ALTER TABLE evaluation_criterion
    ADD COLUMN pillar_weight_locked boolean NOT NULL DEFAULT false;

-- 2. The gates a reading enforced and the compound rules it applied. A row means on; off is the
--    absence of a row, as it is for a live set's rule associations.
CREATE TABLE evaluation_match_rule (
    evaluation bigint NOT NULL REFERENCES evaluation (id) ON DELETE CASCADE,
    match_rule text   NOT NULL REFERENCES match_rule (id),

    CONSTRAINT evaluation_match_rule_pkey PRIMARY KEY (evaluation, match_rule)
);

CREATE TABLE evaluation_compound_rule (
    evaluation    bigint NOT NULL REFERENCES evaluation (id) ON DELETE CASCADE,
    compound_rule text   NOT NULL REFERENCES compound_rule (id),

    CONSTRAINT evaluation_compound_rule_pkey PRIMARY KEY (evaluation, compound_rule)
);

-- 3a. The value rows behind a `not_matching` compound rule, the mirror of candidate_warning_input
--     for the rule that ruled a candidate out. Keyed to the candidate_result and carrying its
--     ordinal so the figures read back in the order the rule's conditions name them.
CREATE TABLE non_match_input (
    candidate_result bigint  NOT NULL REFERENCES candidate_result (id) ON DELETE CASCADE,
    compound_rule    text    NOT NULL REFERENCES compound_rule (id),
    value_id         bigint  NOT NULL REFERENCES value (id),
    ordinal          integer NOT NULL,

    CONSTRAINT non_match_input_pkey PRIMARY KEY (candidate_result, compound_rule, value_id)
);

-- 3b. The order a warning's inputs read in. Nullable-free with a default so the rows 0504 could
--     have written (none shipped) remain valid; new rows carry the condition index.
ALTER TABLE candidate_warning_input
    ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
