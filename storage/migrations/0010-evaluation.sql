-- One criteria set run against the candidates at one level, and what came out.
--
-- Score, coverage, match status, rank and parent_not_matching belong here rather than to the
-- candidate: every one of them changes the moment you switch criteria sets, and none is a
-- property of the place (reqs.md 3.4a).
-- depends: 0009-criteria

CREATE TABLE evaluation (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criteria_set text        NOT NULL REFERENCES criteria_set (id),
    -- An evaluation runs at one level, so a comparison can never mix levels.
    level        text        NOT NULL REFERENCES level (id),
    computed_at  timestamptz NOT NULL
);

COMMENT ON TABLE evaluation IS
    'Written only when a result is deliberately kept. Adjusting a weight recalculates in memory; a row here is one you wanted (reqs.md 3.4a).';

-- The criteria the evaluation used, frozen. A criteria set stays editable -- that is the
-- point of saving one -- but an evaluation must not change underneath you. The snapshot also
-- records which attributes were in scope, so a coverage figure keeps its meaning after the
-- catalog grows.
--
-- The freeze covers the whole interpretation, not just the weights. Weight, goal and
-- normalisation method alone do not determine a score: a `fixed` scale needs its anchor
-- points, a `target_range` goal needs its band and its zero points, and a broken-down
-- attribute needs to know which option was read or whether they were aggregated. Revise an
-- anchor next year -- which is expected, since none has been chosen yet -- and a reopened
-- evaluation would show a total its own drill-down could no longer reproduce.
--
-- The measurement side is already frozen: candidate_attribute_score.used_value pins the exact
-- value row behind every contribution. These columns and the anchor table below close the
-- interpretation side, which is the other half of the same promise.
CREATE TABLE evaluation_criterion (
    evaluation           bigint  NOT NULL REFERENCES evaluation (id),
    attribute            text    NOT NULL REFERENCES attribute (id),
    pillar               text    NOT NULL REFERENCES pillar (id),
    is_scored            boolean NOT NULL,
    weight               numeric NOT NULL,
    pillar_weight        numeric NOT NULL,
    goal                 text    NOT NULL,
    target_range_min     numeric,
    target_range_max     numeric,
    zero_score_below     numeric,
    zero_score_above     numeric,
    normalisation_method text    NOT NULL,
    -- Which case of a broken-down attribute was read, and how. Frozen because both are part of
    -- what produced the number: a rent for a two-bedroom flat is not a rent averaged over all
    -- of them.
    breakdown_option     text REFERENCES breakdown_option (id),
    reducer_mode         text,
    blocks_if_missing    boolean NOT NULL,

    CONSTRAINT evaluation_criterion_pkey PRIMARY KEY (evaluation, attribute),
    CONSTRAINT evaluation_criterion_goal_is_known
        CHECK (goal IN ('minimise', 'maximise', 'target_range')),
    CONSTRAINT evaluation_criterion_normalisation_method_is_known
        CHECK (normalisation_method IN ('fixed', 'percentile', 'as_is')),
    CONSTRAINT evaluation_criterion_reducer_mode_is_known
        CHECK (reducer_mode IS NULL OR reducer_mode IN ('select', 'aggregate')),
    CONSTRAINT evaluation_criterion_weights_are_not_negative
        CHECK (weight >= 0 AND pillar_weight >= 0),
    -- The same three rules the live criterion is held to, so a snapshot cannot record an
    -- interpretation the criteria module would have refused to make.
    CONSTRAINT evaluation_criterion_target_range_is_ordered
        CHECK (target_range_min IS NULL OR target_range_max IS NULL
               OR target_range_min <= target_range_max),
    CONSTRAINT evaluation_criterion_target_range_has_a_band
        CHECK (goal <> 'target_range'
               OR (target_range_min IS NOT NULL AND target_range_max IS NOT NULL)),
    CONSTRAINT evaluation_criterion_zero_scores_lie_outside_the_band
        CHECK ((zero_score_below IS NULL OR target_range_min IS NULL
                OR zero_score_below <= target_range_min)
           AND (zero_score_above IS NULL OR target_range_max IS NULL
                OR zero_score_above >= target_range_max)),
    CONSTRAINT evaluation_criterion_select_names_an_option
        CHECK (reducer_mode IS DISTINCT FROM 'select' OR breakdown_option IS NOT NULL),
    CONSTRAINT evaluation_criterion_aggregate_names_no_option
        CHECK (reducer_mode IS DISTINCT FROM 'aggregate' OR breakdown_option IS NULL)
);

-- The frozen twin of criterion_scale_anchor, keyed on the evaluation and the attribute rather
-- than on a criterion id, because the criterion it was copied from stays editable and may
-- since have been deleted. Rows rather than a JSON blob, for the same reason as the original:
-- "500 EUR -> 100, 2500 EUR -> 0" should be inspectable in the drill-down that explains a
-- number, not buried in a document.
CREATE TABLE evaluation_scale_anchor (
    evaluation  bigint  NOT NULL,
    attribute   text    NOT NULL,
    input_value numeric NOT NULL,
    score       integer NOT NULL,

    CONSTRAINT evaluation_scale_anchor_pkey PRIMARY KEY (evaluation, attribute, input_value),
    CONSTRAINT evaluation_scale_anchor_belongs_to_a_frozen_criterion
        FOREIGN KEY (evaluation, attribute)
            REFERENCES evaluation_criterion (evaluation, attribute),
    CONSTRAINT evaluation_scale_anchor_score_is_not_negative CHECK (score >= 0)
);

CREATE TABLE candidate_result (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evaluation          bigint  NOT NULL REFERENCES evaluation (id),
    candidate           text    NOT NULL REFERENCES candidate (id),
    -- Null when the candidate is insufficient data: never fabricate a total from what is
    -- missing. A non-matching candidate keeps its score and stays visible (reqs.md 5.4).
    score               integer,
    -- The share of active weight actually backed by data.
    coverage            numeric NOT NULL,
    match_status        text    NOT NULL,
    parent_not_matching boolean NOT NULL DEFAULT false,
    rank                integer,

    CONSTRAINT candidate_result_natural_key UNIQUE (evaluation, candidate),
    CONSTRAINT candidate_result_status_is_known_vocabulary
        CHECK (match_status IN ('matching', 'not_matching', 'insufficient_data')),
    CONSTRAINT candidate_result_score_is_not_negative CHECK (score IS NULL OR score >= 0),
    CONSTRAINT candidate_result_coverage_is_not_negative CHECK (coverage >= 0),
    CONSTRAINT candidate_result_rank_is_positive CHECK (rank IS NULL OR rank >= 1)
);

-- The per-attribute detail behind the total, stored rather than recomputed. The criteria
-- snapshot freezes the weights but not the code that applies them; storing the outcome makes
-- a saved evaluation read identically however the scoring engine later changes. It also
-- closes the provenance chain, from a total to the single value behind one contribution.
CREATE TABLE candidate_attribute_score (
    candidate_result bigint  NOT NULL REFERENCES candidate_result (id),
    attribute        text    NOT NULL REFERENCES attribute (id),
    -- Null when no value was available and the weight was redistributed away.
    used_value       bigint REFERENCES value (id),
    normalised_score integer,
    -- After redistribution for missing data. Never written back into the stored weights.
    effective_weight numeric NOT NULL,
    contribution     numeric NOT NULL,

    CONSTRAINT candidate_attribute_score_pkey PRIMARY KEY (candidate_result, attribute),
    CONSTRAINT candidate_attribute_score_is_not_negative
        CHECK (normalised_score IS NULL OR normalised_score >= 0),
    CONSTRAINT candidate_attribute_score_weight_is_not_negative CHECK (effective_weight >= 0)
);

-- Both mechanisms feed one surface, so the user never looks in two places to learn why a
-- candidate is out. Exactly one of the three is set per row.
CREATE TABLE non_match_reason (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_result bigint NOT NULL REFERENCES candidate_result (id),
    criterion        bigint REFERENCES criterion (id),
    match_rule       text REFERENCES match_rule (id),
    compound_rule    text REFERENCES compound_rule (id),
    reason_detail    text   NOT NULL,

    CONSTRAINT non_match_reason_names_exactly_one_rule
        CHECK (num_nonnulls(criterion, match_rule, compound_rule) = 1)
);

-- A warning flags without ruling anything out. It never changes the score and never makes a
-- candidate not match; it is stored with the result so a saved evaluation reads the same
-- later (reqs.md 5.3).
CREATE TABLE candidate_warning (
    candidate_result bigint NOT NULL REFERENCES candidate_result (id),
    compound_rule    text   NOT NULL REFERENCES compound_rule (id),
    detail           text   NOT NULL,

    CONSTRAINT candidate_warning_pkey PRIMARY KEY (candidate_result, compound_rule)
);
