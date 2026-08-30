-- Match rules and their results, compound rules and their inputs, and external scores.
--
-- All of these sit on the objective side: whether a visa route exists is a fact about the
-- world. Whether its absence disqualifies a candidate is a preference, and lives with the
-- criteria set (arch.md 3.6).
-- depends: 0006-value-payloads

CREATE TABLE match_rule (
    id    text PRIMARY KEY,
    -- Null where a rule applies at every level.
    level text REFERENCES level (id),
    name  text NOT NULL
);

COMMENT ON TABLE match_rule IS
    'A named yes/no gate attached to no attribute -- visa pathways, quotas, feasibility (reqs.md 3.7).';

CREATE TABLE match_rule_result (
    match_rule             text NOT NULL REFERENCES match_rule (id),
    candidate              text NOT NULL REFERENCES candidate (id),
    match_result           text NOT NULL,
    reason                 text,
    data_source            text NOT NULL REFERENCES data_source (id),
    -- A gate ages like any other finding, so it carries the same two dates.
    reference_period_start date,
    reference_period_end   date,
    retrieval_date         timestamptz NOT NULL,
    override_reason        text,
    override_date          date,

    CONSTRAINT match_rule_result_pkey PRIMARY KEY (match_rule, candidate),
    CONSTRAINT match_rule_result_is_known_vocabulary
        CHECK (match_result IN ('matching', 'not_matching', 'unknown')),
    CONSTRAINT match_rule_result_reference_period_is_ordered
        CHECK (reference_period_end IS NULL
               OR reference_period_start IS NULL
               OR reference_period_end >= reference_period_start),
    CONSTRAINT match_rule_result_override_is_all_or_nothing
        CHECK ((override_reason IS NULL) = (override_date IS NULL))
);

CREATE TABLE compound_rule (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    level         text REFERENCES level (id),
    -- Which rule shape performs the comparison. The comparison is code; the rule is data.
    shape         text NOT NULL,
    outcome       text NOT NULL,
    threshold_min numeric,
    threshold_max numeric,

    CONSTRAINT compound_rule_shape_is_known
        CHECK (shape IN ('ShareOfHouseholdField', 'SumBelowFloor', 'RatioBetweenAttributes')),
    CONSTRAINT compound_rule_outcome_is_known
        CHECK (outcome IN ('warning', 'not_matching')),
    CONSTRAINT compound_rule_thresholds_are_ordered
        CHECK (threshold_min IS NULL OR threshold_max IS NULL OR threshold_min <= threshold_max),

    -- Which thresholds a shape uses is fixed by the shape. The constraint forbids the ones a
    -- shape has no meaning for rather than requiring the ones it does, because a rule whose
    -- threshold is still TBD ships with it NULL and inactive (reqs.md 7.4) -- and a NOT NULL
    -- rule here would force someone to invent a number.
    CONSTRAINT compound_rule_thresholds_suit_the_shape CHECK (
        CASE shape
            WHEN 'ShareOfHouseholdField'   THEN threshold_min IS NULL
            WHEN 'SumBelowFloor'           THEN threshold_max IS NULL
            ELSE true
        END
    )
);

COMMENT ON TABLE compound_rule IS
    'A rule over more than one input, for things only visible when two figures are read together (reqs.md 3.7a).';

CREATE TABLE compound_rule_input (
    compound_rule   text    NOT NULL REFERENCES compound_rule (id),
    -- Order matters: a ratio of A to B is not a ratio of B to A.
    input_order     integer NOT NULL,
    attribute       text REFERENCES attribute (id),
    household_field text REFERENCES household_field (id),

    CONSTRAINT compound_rule_input_pkey PRIMARY KEY (compound_rule, input_order),
    CONSTRAINT compound_rule_input_is_one_thing
        CHECK (num_nonnulls(attribute, household_field) = 1),
    CONSTRAINT compound_rule_input_order_is_positive CHECK (input_order > 0)
);

CREATE TABLE external_score (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate              text NOT NULL REFERENCES candidate (id),
    data_source            text NOT NULL REFERENCES data_source (id),
    published_value        numeric,
    -- What the number means: 0-100, 0-10, rank, index.
    published_scale        text NOT NULL,
    published_rank         integer,
    published_rank_of      integer,
    reference_period_start date NOT NULL,
    reference_period_end   date NOT NULL,
    retrieval_date         timestamptz NOT NULL,
    methodology_url        text,
    caveats                text,

    CONSTRAINT external_score_natural_key
        UNIQUE (candidate, data_source, reference_period_start, retrieval_date),
    CONSTRAINT external_score_says_something
        CHECK (published_value IS NOT NULL OR published_rank IS NOT NULL),
    CONSTRAINT external_score_rank_is_out_of_a_field
        CHECK (published_rank IS NULL
               OR (published_rank_of IS NOT NULL AND published_rank <= published_rank_of)),
    CONSTRAINT external_score_reference_period_is_ordered
        CHECK (reference_period_end >= reference_period_start)
);

COMMENT ON TABLE external_score IS
    'A score published by an outside index, displayed beside the score and never fed into it. A separate entity, not a value with a flag -- a flag gets forgotten in a join and silently ends up inside a sum (reqs.md 3.5a).';
