-- Criteria sets: the subjective half of the model, and the only place a preference may live.
--
-- Nothing here is ever referenced from the objective side. That absence is what makes
-- switching from one criteria set to another pure arithmetic over stored rows, and why it can
-- never trigger a fetch (arch.md 3.6, reqs.md 5.6).
--
-- Weights carry no upper bound. reqs.md says they sum to 100 within a pillar and within a
-- level; openapi.yaml expresses the same weights as fractions of 1. The sum rule is a
-- rebalancing invariant the criteria module owns either way, so the schema asserts only what
-- both readings agree on: a weight is not negative.
-- depends: 0008-household-and-settings

CREATE TABLE criteria_set (
    id   text PRIMARY KEY,
    name text NOT NULL
);

COMMENT ON TABLE criteria_set IS
    'A named collection of criteria plus its pillar weights. Work-format scenarios and per-person sets are the same primitive (reqs.md 3.4).';

CREATE TABLE pillar_weight (
    criteria_set  text    NOT NULL REFERENCES criteria_set (id),
    pillar        text    NOT NULL REFERENCES pillar (id),
    weight        numeric NOT NULL,
    -- A locked weight holds its value and is excluded from proportional rebalancing.
    weight_locked boolean NOT NULL DEFAULT false,

    CONSTRAINT pillar_weight_pkey PRIMARY KEY (criteria_set, pillar),
    CONSTRAINT pillar_weight_is_not_negative CHECK (weight >= 0)
);

COMMENT ON TABLE pillar_weight IS
    'Pillar weights belong to a set, not to the pillar: two people weight the same eleven verticals differently.';

CREATE TABLE criterion (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criteria_set        text    NOT NULL REFERENCES criteria_set (id),
    attribute           text    NOT NULL,
    -- Restated for the same reason a value restates it: it makes the link to the attribute a
    -- composite key, so a threshold child can pin its own type (arch.md 3.3b).
    value_type          text    NOT NULL REFERENCES value_type (id),
    breakdown_option    text REFERENCES breakdown_option (id),
    -- Whether this criterion counts toward the score at all. Excluding one redistributes
    -- weight and does NOT count against coverage -- nothing is missing, you decided it does
    -- not apply (reqs.md 5.3).
    is_scored           boolean NOT NULL DEFAULT true,
    weight              numeric NOT NULL,
    weight_locked       boolean NOT NULL DEFAULT false,
    goal                text    NOT NULL,
    target_range_min    numeric,
    target_range_max    numeric,
    -- Where the score reaches 0 outside the band, in the attribute's own unit.
    zero_score_below    numeric,
    zero_score_above    numeric,
    normalisation_method text   NOT NULL,
    reducer_mode        text,
    -- If true, a missing value makes the candidate unscoreable regardless of coverage.
    blocks_if_missing   boolean NOT NULL DEFAULT false,

    -- One criterion per attribute per set. Many criteria may judge one attribute -- one per
    -- set -- and an attribute with no criterion is descriptive and never scored.
    CONSTRAINT criterion_natural_key UNIQUE (criteria_set, attribute),
    -- Referenceable so each threshold child can be pinned to this criterion's type.
    CONSTRAINT criterion_type_key UNIQUE (id, value_type),
    CONSTRAINT criterion_matches_attribute_type
        FOREIGN KEY (attribute, value_type) REFERENCES attribute (id, value_type),

    CONSTRAINT criterion_goal_is_known
        CHECK (goal IN ('minimise', 'maximise', 'target_range')),
    CONSTRAINT criterion_normalisation_method_is_known
        CHECK (normalisation_method IN ('fixed', 'percentile', 'as_is')),
    CONSTRAINT criterion_reducer_mode_is_known
        CHECK (reducer_mode IS NULL OR reducer_mode IN ('select', 'aggregate')),
    CONSTRAINT criterion_weight_is_not_negative CHECK (weight >= 0),
    CONSTRAINT criterion_target_range_is_ordered
        CHECK (target_range_min IS NULL OR target_range_max IS NULL
               OR target_range_min <= target_range_max),
    -- A target range is four numbers in the attribute's own unit; the band itself is what
    -- scores 100, so a target_range goal without one means nothing.
    CONSTRAINT criterion_target_range_has_a_band
        CHECK (goal <> 'target_range'
               OR (target_range_min IS NOT NULL AND target_range_max IS NOT NULL)),
    CONSTRAINT criterion_zero_scores_lie_outside_the_band
        CHECK ((zero_score_below IS NULL OR target_range_min IS NULL
                OR zero_score_below <= target_range_min)
           AND (zero_score_above IS NULL OR target_range_max IS NULL
                OR zero_score_above >= target_range_max)),
    -- Selecting one option means naming it; aggregating across all of them means not naming one.
    CONSTRAINT criterion_select_names_an_option
        CHECK (reducer_mode IS DISTINCT FROM 'select' OR breakdown_option IS NOT NULL),
    CONSTRAINT criterion_aggregate_names_no_option
        CHECK (reducer_mode IS DISTINCT FROM 'aggregate' OR breakdown_option IS NULL)
);

COMMENT ON TABLE criterion IS
    'The rule you impose on one attribute: this attribute, toward this goal, against this limit, worth this much (reqs.md 3.4).';

-- The fixed scale's anchor points: an input value and the score it maps to. Rows rather than
-- a JSON blob, so "500 EUR -> 100, 2500 EUR -> 0" is inspectable and checkable.
CREATE TABLE criterion_scale_anchor (
    criterion   bigint  NOT NULL REFERENCES criterion (id),
    input_value numeric NOT NULL,
    score       integer NOT NULL,

    CONSTRAINT criterion_scale_anchor_pkey PRIMARY KEY (criterion, input_value),
    CONSTRAINT criterion_scale_anchor_score_is_not_negative CHECK (score >= 0)
);

-- The four threshold children. Exactly one kind may apply to a criterion, and which one is
-- decided by the attribute's value type -- enforced by the same composite key that governs
-- values, so a LabelSet attribute cannot be given a numeric range (reqs.md 3.4).

CREATE TABLE criterion_threshold_range (
    criterion  bigint PRIMARY KEY,
    value_type text NOT NULL,
    min_value  numeric,
    max_value  numeric,

    CONSTRAINT criterion_threshold_range_suits_its_type
        CHECK (value_type IN ('Monetary', 'Quantity', 'Count', 'Ratio', 'Index', 'AssignedScore')),
    CONSTRAINT criterion_threshold_range_agrees_with_criterion
        FOREIGN KEY (criterion, value_type) REFERENCES criterion (id, value_type),
    CONSTRAINT criterion_threshold_range_declares_a_bound
        CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
    CONSTRAINT criterion_threshold_range_is_ordered
        CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE criterion_threshold_label (
    criterion        bigint NOT NULL,
    value_type       text   NOT NULL,
    label            text   NOT NULL,
    containment_rule text   NOT NULL,

    CONSTRAINT criterion_threshold_label_pkey PRIMARY KEY (criterion, label),
    CONSTRAINT criterion_threshold_label_is_labelset CHECK (value_type = 'LabelSet'),
    CONSTRAINT criterion_threshold_label_agrees_with_criterion
        FOREIGN KEY (criterion, value_type) REFERENCES criterion (id, value_type),
    CONSTRAINT criterion_threshold_label_containment_is_known
        CHECK (containment_rule IN ('must_contain', 'must_not_contain'))
);

CREATE TABLE criterion_threshold_boolean (
    criterion      bigint  PRIMARY KEY,
    value_type     text    NOT NULL,
    required_value boolean NOT NULL,

    CONSTRAINT criterion_threshold_boolean_is_boolean CHECK (value_type = 'Boolean'),
    CONSTRAINT criterion_threshold_boolean_agrees_with_criterion
        FOREIGN KEY (criterion, value_type) REFERENCES criterion (id, value_type)
);

CREATE TABLE criterion_threshold_share (
    criterion  bigint NOT NULL,
    value_type text   NOT NULL,
    label      text   NOT NULL,
    min_share  numeric,
    max_share  numeric,

    CONSTRAINT criterion_threshold_share_pkey PRIMARY KEY (criterion, label),
    CONSTRAINT criterion_threshold_share_is_sharecomposition
        CHECK (value_type = 'ShareComposition'),
    CONSTRAINT criterion_threshold_share_agrees_with_criterion
        FOREIGN KEY (criterion, value_type) REFERENCES criterion (id, value_type),
    CONSTRAINT criterion_threshold_share_declares_a_bound
        CHECK (min_share IS NOT NULL OR max_share IS NOT NULL),
    CONSTRAINT criterion_threshold_share_is_a_percentage
        CHECK ((min_share IS NULL OR (min_share >= 0 AND min_share <= 100))
           AND (max_share IS NULL OR (max_share >= 0 AND max_share <= 100))),
    CONSTRAINT criterion_threshold_share_is_ordered
        CHECK (min_share IS NULL OR max_share IS NULL OR min_share <= max_share)
);

-- Whether a gate is enforced is a preference, not a fact about the world. This is what gives
-- match rules the same objective/subjective split attributes already have.
CREATE TABLE criteria_set_match_rule (
    criteria_set text    NOT NULL REFERENCES criteria_set (id),
    match_rule   text    NOT NULL REFERENCES match_rule (id),
    is_enforced  boolean NOT NULL,

    CONSTRAINT criteria_set_match_rule_pkey PRIMARY KEY (criteria_set, match_rule)
);

CREATE TABLE criteria_set_compound_rule (
    criteria_set  text    NOT NULL REFERENCES criteria_set (id),
    compound_rule text    NOT NULL REFERENCES compound_rule (id),
    is_applied    boolean NOT NULL,

    CONSTRAINT criteria_set_compound_rule_pkey PRIMARY KEY (criteria_set, compound_rule)
);
