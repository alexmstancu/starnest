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
    -- An override is a moment the system records, not a span in the world, so timestamptz --
    -- the same rule that governs retrieval_date above it (arch.md 9.6).
    override_date          timestamptz,

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

-- The pages behind a gate, for the same reason value_citation exists. Visa routes, quotas and
-- permit timing are decided by manual and LLM-assisted research (reqs.md 6.9, 6.10), and both
-- of those must show what was actually read. A gate is displayed as a reason a candidate is
-- out, so it carries the heaviest burden of proof in the product -- yet without this table its
-- provenance stopped at a source id and a free-text reason.
CREATE TABLE match_rule_result_citation (
    match_rule text NOT NULL,
    candidate  text NOT NULL,
    url        text NOT NULL,

    CONSTRAINT match_rule_result_citation_pkey PRIMARY KEY (match_rule, candidate, url),
    CONSTRAINT match_rule_result_citation_belongs_to_a_result
        FOREIGN KEY (match_rule, candidate) REFERENCES match_rule_result (match_rule, candidate)
);

COMMENT ON TABLE match_rule_result_citation IS
    'The pages behind a gate decision. A list, therefore a table -- the match_rule_result twin of value_citation (reqs.md 6.9, 6.10).';

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
        CHECK (shape IN ('ShareOfHouseholdField', 'SumBelowFloor', 'AllConditionsHold')),
    CONSTRAINT compound_rule_outcome_is_known
        CHECK (outcome IN ('warning', 'not_matching')),
    CONSTRAINT compound_rule_thresholds_are_ordered
        CHECK (threshold_min IS NULL OR threshold_max IS NULL OR threshold_min <= threshold_max),

    -- Referenceable so each child row can be pinned to its rule's shape, the same trick that
    -- keeps a monetary payload off a count value (arch.md 3.3b).
    CONSTRAINT compound_rule_shape_key UNIQUE (id, shape),

    -- Which thresholds a shape uses is fixed by the shape. The constraint forbids the ones a
    -- shape has no meaning for rather than requiring the ones it does, because a rule whose
    -- threshold is still TBD ships with it NULL and inactive (reqs.md 7.4) -- and a NOT NULL
    -- rule here would force someone to invent a number.
    --
    -- AllConditionsHold carries no rule-level threshold at all: every number it compares is a
    -- bound on one named attribute in that attribute's own unit, and those live one per
    -- condition row.
    CONSTRAINT compound_rule_thresholds_suit_the_shape CHECK (
        CASE shape
            WHEN 'ShareOfHouseholdField' THEN threshold_min IS NULL
            WHEN 'SumBelowFloor'         THEN threshold_max IS NULL
            WHEN 'AllConditionsHold'     THEN threshold_min IS NULL AND threshold_max IS NULL
            ELSE true
        END
    )
);

COMMENT ON TABLE compound_rule IS
    'A rule over more than one input, for things only visible when two figures are read together (reqs.md 3.7a).';

-- The inputs of the two shapes that read a list of figures and compare the list as a whole:
-- ShareOfHouseholdField measures one attribute against one household number, SumBelowFloor
-- adds several attributes up. Neither carries a per-input bound, because neither compares any
-- single input to anything -- the comparison is on what the inputs produce together.
--
-- AllConditionsHold reads compound_rule_condition instead, and the shape column below is what
-- keeps the two apart: a rule stores inputs or conditions, never both, and never the wrong
-- kind. The composite foreign key to (id, shape) makes that a constraint rather than a
-- convention.
CREATE TABLE compound_rule_input (
    compound_rule   text    NOT NULL,
    shape           text    NOT NULL,
    -- Order matters: it is what lets a shape tell its numerator from its denominator, or name
    -- the figure a share is taken of.
    input_order     integer NOT NULL,
    attribute       text REFERENCES attribute (id),
    household_field text REFERENCES household_field (id),

    CONSTRAINT compound_rule_input_pkey PRIMARY KEY (compound_rule, input_order),
    CONSTRAINT compound_rule_input_suits_its_shape
        CHECK (shape IN ('ShareOfHouseholdField', 'SumBelowFloor')),
    CONSTRAINT compound_rule_input_agrees_with_its_rule
        FOREIGN KEY (compound_rule, shape) REFERENCES compound_rule (id, shape),
    CONSTRAINT compound_rule_input_is_one_thing
        CHECK (num_nonnulls(attribute, household_field) = 1),
    CONSTRAINT compound_rule_input_order_is_positive CHECK (input_order > 0)
);

-- The conditions of AllConditionsHold: N independent bounds, each on ONE attribute, each in
-- that attribute's own unit. The rule fires when every condition holds.
--
-- This shape replaced a ratio between two attributes, which was wrong for every rule that used
-- it. Dividing degrees Celsius by a count of days divides an interval scale by a count: the
-- units do not cancel, the quotient means nothing, and near a mean of 0 degrees it explodes
-- and then changes sign. Dividing a cost index by a tax percentage is the same mistake in
-- different units. All three of the rules written against that shape were, read plainly,
-- conjunctions of two independent thresholds -- so the shape is the conjunction, and N of them
-- rather than two, because a two-condition shape is outgrown by the third rule that needs one
-- more.
--
-- AND is implicit in the shape's name and is the only connective there is. There is no
-- operator column, no connective column, no nesting and no OR -- those would be an expression
-- language, which reqs.md 3.0 exists to forbid. Every row here is a parameter; none is an
-- instruction. A rule needing OR is a new shape, which is code and a release.
CREATE TABLE compound_rule_condition (
    compound_rule text    NOT NULL,
    shape         text    NOT NULL,
    ordinal       integer NOT NULL,
    attribute     text    NOT NULL REFERENCES attribute (id),
    -- The bounds are inclusive, and NULL means unbounded on that side. Both NULL is a
    -- condition that is not yet decided: every threshold in reqs.md 7.4 is TBD, so requiring a
    -- bound here would force someone to invent one (devplan.md 0.3 rule 2).
    threshold_min numeric,
    threshold_max numeric,

    CONSTRAINT compound_rule_condition_pkey PRIMARY KEY (compound_rule, ordinal),
    CONSTRAINT compound_rule_condition_suits_its_shape
        CHECK (shape = 'AllConditionsHold'),
    CONSTRAINT compound_rule_condition_agrees_with_its_rule
        FOREIGN KEY (compound_rule, shape) REFERENCES compound_rule (id, shape),
    CONSTRAINT compound_rule_condition_ordinal_is_positive CHECK (ordinal > 0),
    CONSTRAINT compound_rule_condition_is_ordered
        CHECK (threshold_min IS NULL OR threshold_max IS NULL OR threshold_min <= threshold_max),
    -- Two conditions on one attribute would always reduce to a single narrower interval, so a
    -- second one is either a mistake or the beginning of a grammar. One per attribute.
    CONSTRAINT compound_rule_condition_judges_each_attribute_once
        UNIQUE (compound_rule, attribute)
);

COMMENT ON TABLE compound_rule_condition IS
    'One bound on one attribute, in that attribute''s own unit. An AllConditionsHold rule fires when every one of its conditions holds; AND is the only connective and it is implicit (reqs.md 3.0, 3.7a).';

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
