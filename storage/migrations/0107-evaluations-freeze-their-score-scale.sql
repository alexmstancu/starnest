-- An evaluation records the scale its scores are on, and nothing it holds may leave that scale.
--
-- Two defects, one cause. Six columns across four tables carried a floor and no ceiling, so
-- `score = 999` and `coverage = 4200` both inserted (known-issues D3, D25). And the reason no
-- ceiling was ever written is that there was nowhere to read one from: the ceiling is
-- `settings.score_scale_max`, a row in another table, and a CHECK sees only its own row.
--
-- reqs.md Q193 already required the missing piece for an unrelated reason. A saved evaluation
-- freezes the interpretation that produced its scores -- target range, reducer, breakdown
-- option, anchors -- because otherwise a reopened evaluation shows a total its own drill-down
-- can no longer reproduce. The SCALE is part of that interpretation and was the one piece left
-- unfrozen: change score_scale_max from 100 to 10 tomorrow and every score saved today becomes
-- a number with no stated meaning. Freezing it is owed regardless of the ceilings; that it also
-- puts the ceiling within reach of a CHECK is the reason both arrive together.
--
-- The scale is then carried down to each table that stores a score, pinned by a composite
-- foreign key so the copy cannot disagree with the original. That trick is this schema's
-- established idiom, not an invention for this migration: candidate.parent_level,
-- criterion.value_type, value.value_type and criterion.pillar all restate a parent's column for
-- exactly the same purpose -- to put a fact where a constraint can see it.
--
-- Percentages need none of that. Coverage and the two weight columns are shares, and 100 is
-- what a share is out of, so those get a plain 0-100 bound.
--
-- Every table altered here is EMPTY -- evaluation, candidate_result, evaluation_criterion,
-- evaluation_scale_anchor and candidate_attribute_score have never held a row, because nothing
-- writes them until `evaluation/` exists. So NOT NULL columns are added without a backfill and
-- no row is rewritten. This is the last moment at which that is true, which is why it is being
-- done now rather than after the first ranking.
--
-- NOTE FOR `evaluation/`: settings.score_scale_max is nullable and unseeded (reqs.md 3.10 --
-- provisional by design). Saving an evaluation before it is set must REFUSE, naming the missing
-- setting. It must never substitute 100. That is devplan.md 0.3's stop rule applied to a
-- number: a score on an invented scale is exactly the plausible-looking figure this product
-- exists not to produce.
-- depends: 0106-scored-attributes-have-a-pillar

-- --------------------------------------------------------------------------------
-- The evaluation freezes the scale.
-- --------------------------------------------------------------------------------

ALTER TABLE evaluation ADD COLUMN score_scale_max integer NOT NULL;

ALTER TABLE evaluation
    ADD CONSTRAINT evaluation_score_scale_is_positive CHECK (score_scale_max > 0);

-- Referenceable, so the tables below can be pinned to this evaluation's scale. `id` is already
-- the primary key, so neither key restricts `evaluation`; both exist only to be FK targets.
ALTER TABLE evaluation ADD CONSTRAINT evaluation_scale_key UNIQUE (id, score_scale_max);

COMMENT ON COLUMN evaluation.score_scale_max IS
    'The top of the score range this evaluation used, frozen with it. Reopening an old evaluation must show scores on the scale they were computed on (reqs.md Q193).';

-- --------------------------------------------------------------------------------
-- Every stored score sits inside that scale.
-- --------------------------------------------------------------------------------

ALTER TABLE evaluation_scale_anchor ADD COLUMN score_scale_max integer NOT NULL;

ALTER TABLE evaluation_scale_anchor
    ADD CONSTRAINT evaluation_scale_anchor_uses_its_evaluations_scale
        FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation (id, score_scale_max);

ALTER TABLE evaluation_scale_anchor
    DROP CONSTRAINT evaluation_scale_anchor_score_is_not_negative;

ALTER TABLE evaluation_scale_anchor
    ADD CONSTRAINT evaluation_scale_anchor_score_is_on_the_scale
        CHECK (score >= 0 AND score <= score_scale_max);

ALTER TABLE candidate_result ADD COLUMN score_scale_max integer NOT NULL;

ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_uses_its_evaluations_scale
        FOREIGN KEY (evaluation, score_scale_max) REFERENCES evaluation (id, score_scale_max);

-- Referenceable in turn, so a candidate's per-attribute scores inherit the same scale.
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_scale_key UNIQUE (id, score_scale_max);

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_score_is_not_negative;

ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_score_is_on_the_scale
        CHECK (score IS NULL OR (score >= 0 AND score <= score_scale_max));

ALTER TABLE candidate_attribute_score ADD COLUMN score_scale_max integer NOT NULL;

ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_uses_its_results_scale
        FOREIGN KEY (candidate_result, score_scale_max)
            REFERENCES candidate_result (id, score_scale_max);

ALTER TABLE candidate_attribute_score DROP CONSTRAINT candidate_attribute_score_is_not_negative;

ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_is_on_the_scale
        CHECK (normalised_score IS NULL
               OR (normalised_score >= 0 AND normalised_score <= score_scale_max));

-- --------------------------------------------------------------------------------
-- Shares are bounded by what a share is out of.
-- --------------------------------------------------------------------------------

ALTER TABLE candidate_result DROP CONSTRAINT candidate_result_coverage_is_not_negative;

ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_coverage_is_a_percentage
        CHECK (coverage >= 0 AND coverage <= 100);

ALTER TABLE evaluation_criterion DROP CONSTRAINT evaluation_criterion_weights_are_not_negative;

ALTER TABLE evaluation_criterion
    ADD CONSTRAINT evaluation_criterion_weights_are_percentages
        CHECK (weight >= 0 AND weight <= 100 AND pillar_weight >= 0 AND pillar_weight <= 100);

ALTER TABLE candidate_attribute_score
    DROP CONSTRAINT candidate_attribute_score_weight_is_not_negative;

-- Bounded above by 100 like the stored weight it derives from. Redistribution moves weight
-- between criteria and never mints any: a criterion that absorbed every sibling's share holds
-- the whole 100 and no more (reqs.md 5.3).
ALTER TABLE candidate_attribute_score
    ADD CONSTRAINT candidate_attribute_score_weight_is_a_percentage
        CHECK (effective_weight >= 0 AND effective_weight <= 100);
