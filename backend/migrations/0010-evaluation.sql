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
CREATE TABLE evaluation_criterion (
    evaluation           bigint  NOT NULL REFERENCES evaluation (id),
    attribute            text    NOT NULL REFERENCES attribute (id),
    pillar               text    NOT NULL REFERENCES pillar (id),
    is_scored            boolean NOT NULL,
    weight               numeric NOT NULL,
    pillar_weight        numeric NOT NULL,
    goal                 text    NOT NULL,
    normalisation_method text    NOT NULL,
    blocks_if_missing    boolean NOT NULL,

    CONSTRAINT evaluation_criterion_pkey PRIMARY KEY (evaluation, attribute),
    CONSTRAINT evaluation_criterion_goal_is_known
        CHECK (goal IN ('minimise', 'maximise', 'target_range')),
    CONSTRAINT evaluation_criterion_normalisation_method_is_known
        CHECK (normalisation_method IN ('fixed', 'percentile', 'as_is')),
    CONSTRAINT evaluation_criterion_weights_are_not_negative
        CHECK (weight >= 0 AND pillar_weight >= 0)
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
