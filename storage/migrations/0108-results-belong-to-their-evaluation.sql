-- A result sits at its evaluation's level, and a reason points at that evaluation's own
-- frozen criterion.
--
-- Two defects, one shape: a child of an evaluation that could belong to something else
-- entirely (known-issues D2, D26).
--
-- D2. `candidate_result` named a candidate and named an evaluation, and nothing tied the two
-- together, so a CITY could be ranked inside a COUNTRY evaluation. reqs.md 3.1 orders the
-- levels and arch.md 3.5 evaluates one at a time, precisely so a comparison can never mix
-- them; the ranking table was the one place that could. `candidate_level_key` was created in
-- 0002 for exactly this composite trick -- "Referenceable so a child can be checked against
-- its parent's level" -- and then went unused for six migrations.
--
-- D26. `non_match_reason.criterion` pointed at the LIVE criterion table while everything else
-- in 0010 points at the frozen twin. Nothing could orphan -- the key restricts -- so the
-- failure ran the other way and was worse for it: `delete_criterion` (queries/criteria.sql)
-- removes a criterion from a set, and once any saved evaluation had recorded a non-match on
-- that criterion, removing it would fail on a foreign key violation and keep failing. A
-- routine action, permanently broken, with nothing on screen to explain why.
--
-- It also read the wrong thing. A saved evaluation must re-read as it read then (reqs.md
-- Q193), and "the rent criterion" a year later may have a different goal, a different
-- threshold, or may be gone. The reason now names an ATTRIBUTE within the evaluation, which is
-- how `evaluation_scale_anchor` already reaches the same snapshot.
--
-- Both tables are still empty, so no row is rewritten and the column swap costs nothing. That
-- is true only until `evaluation/` runs.
-- depends: 0107-evaluations-freeze-their-score-scale

-- --------------------------------------------------------------------------------
-- D2. A result is at the level its evaluation ran at.
-- --------------------------------------------------------------------------------

-- Referenceable, so a result can be pinned to its evaluation's level.
ALTER TABLE evaluation ADD CONSTRAINT evaluation_level_key UNIQUE (id, level);

ALTER TABLE candidate_result ADD COLUMN level text NOT NULL;

ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_is_at_its_evaluations_level
        FOREIGN KEY (evaluation, level) REFERENCES evaluation (id, level);

-- And the candidate is actually at that level. The two keys together are what make a city in a
-- country ranking unwritable: one says the row's level is the evaluation's, the other says the
-- candidate is at the row's level.
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_ranks_a_candidate_at_that_level
        FOREIGN KEY (candidate, level) REFERENCES candidate (id, level);

COMMENT ON COLUMN candidate_result.level IS
    'The level this result was computed at, restated from the evaluation so the candidate can be checked against it. An evaluation never mixes levels (reqs.md 3.1).';

-- --------------------------------------------------------------------------------
-- D26. A non-match reason names the evaluation's own frozen criterion.
-- --------------------------------------------------------------------------------

-- Referenceable, so a reason can carry the evaluation its result belongs to without being
-- able to name a different one.
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_evaluation_key UNIQUE (id, evaluation);

ALTER TABLE non_match_reason ADD COLUMN evaluation bigint NOT NULL;
ALTER TABLE non_match_reason ADD COLUMN attribute text;

ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_belongs_to_its_results_evaluation
        FOREIGN KEY (candidate_result, evaluation) REFERENCES candidate_result (id, evaluation);

ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_names_a_frozen_criterion
        FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion (evaluation, attribute);

-- The old check names a column that is about to go, so it is replaced rather than edited.
ALTER TABLE non_match_reason DROP CONSTRAINT non_match_reason_names_exactly_one_rule;

ALTER TABLE non_match_reason DROP COLUMN criterion;

ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_names_exactly_one_rule
        CHECK (num_nonnulls(attribute, match_rule, compound_rule) = 1);

COMMENT ON COLUMN non_match_reason.attribute IS
    'Which of the evaluation''s frozen criteria ruled the candidate out. An attribute rather than a criterion id, because the live criterion stays editable and may since have been deleted (reqs.md Q193).';
