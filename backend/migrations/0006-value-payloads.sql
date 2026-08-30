-- The ten typed payload tables (arch.md 3.3).
--
-- Rather than one table with nullable columns for every type, or ten unrelated tables, the
-- shape is a parent with typed children. Two things follow: the database can enforce the
-- type-implicit validation of reqs.md 3.3a with real constraints, and the four hot queries
-- read `value` alone and never touch a child.
--
-- Every table below closes link 3 of the type-agreement chain (arch.md 3.3b): a CHECK pins
-- the table's own type, and the composite foreign key refuses to attach it to a value of any
-- other type. The catalog says Monetary, so the value must say Monetary, so only the monetary
-- payload can attach -- and its primary key on value_id makes it the only one.
-- depends: 0005-values

CREATE TABLE value_monetary (
    value_id     bigint PRIMARY KEY,
    value_type   text    NOT NULL,
    -- The published figure, retained exactly as issued.
    amount       numeric NOT NULL,
    currency     text    NOT NULL REFERENCES currency (id),
    -- The EUR equivalent, and the rate that produced it (reqs.md 5.5).
    amount_eur   numeric NOT NULL,
    fx_rate      numeric,
    fx_rate_date date,

    CONSTRAINT value_monetary_is_monetary CHECK (value_type = 'Monetary'),
    CONSTRAINT value_monetary_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),

    CONSTRAINT value_monetary_amount_is_finite   CHECK (amount <> 'NaN'::numeric),
    CONSTRAINT value_monetary_eur_is_finite      CHECK (amount_eur <> 'NaN'::numeric),
    CONSTRAINT value_monetary_rate_is_positive   CHECK (fx_rate IS NULL OR fx_rate > 0),
    CONSTRAINT value_monetary_rate_is_dated      CHECK ((fx_rate IS NULL) = (fx_rate_date IS NULL)),
    -- A non-EUR figure had to be converted, so it must name the rate that converted it.
    CONSTRAINT value_monetary_conversion_is_sourced
        CHECK (currency = 'EUR' OR fx_rate IS NOT NULL)
);

CREATE TABLE value_quantity (
    value_id   bigint PRIMARY KEY,
    value_type text    NOT NULL,
    magnitude  numeric NOT NULL,
    unit       text    NOT NULL REFERENCES unit (id),

    CONSTRAINT value_quantity_is_quantity CHECK (value_type = 'Quantity'),
    CONSTRAINT value_quantity_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_quantity_magnitude_is_finite CHECK (magnitude <> 'NaN'::numeric)
);

CREATE TABLE value_count (
    value_id   bigint PRIMARY KEY,
    value_type text   NOT NULL,
    count      bigint NOT NULL,
    -- Optional: per capita, per km2.
    basis      text,

    CONSTRAINT value_count_is_count CHECK (value_type = 'Count'),
    CONSTRAINT value_count_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_count_is_not_negative CHECK (count >= 0)
);

CREATE TABLE value_ratio (
    value_id   bigint PRIMARY KEY,
    value_type text    NOT NULL,
    value      numeric NOT NULL,
    -- What it is a share of.
    basis      text    NOT NULL,

    CONSTRAINT value_ratio_is_ratio CHECK (value_type = 'Ratio'),
    CONSTRAINT value_ratio_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_ratio_is_a_percentage CHECK (value >= 0 AND value <= 100)
);

CREATE TABLE value_index (
    value_id   bigint PRIMARY KEY,
    value_type text    NOT NULL,
    value      numeric NOT NULL,
    provider   text    NOT NULL,
    scale_min  numeric NOT NULL,
    scale_max  numeric NOT NULL,

    CONSTRAINT value_index_is_index CHECK (value_type = 'Index'),
    CONSTRAINT value_index_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_index_scale_is_ordered CHECK (scale_min < scale_max),
    CONSTRAINT value_index_is_within_its_scale CHECK (value >= scale_min AND value <= scale_max)
);

-- A LabelSet value carries a list, so the payload is one row per label. Exclusivity across
-- payload tables still holds: the composite key admits only LabelSet values here.
CREATE TABLE value_labelset (
    value_id   bigint NOT NULL,
    value_type text   NOT NULL,
    label      text   NOT NULL,

    CONSTRAINT value_labelset_pkey PRIMARY KEY (value_id, label),
    CONSTRAINT value_labelset_is_labelset CHECK (value_type = 'LabelSet'),
    CONSTRAINT value_labelset_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type)
);

CREATE TABLE value_sharecomp (
    value_id   bigint  NOT NULL,
    value_type text    NOT NULL,
    label      text    NOT NULL,
    share      numeric NOT NULL,

    CONSTRAINT value_sharecomp_pkey PRIMARY KEY (value_id, label),
    CONSTRAINT value_sharecomp_is_sharecomposition CHECK (value_type = 'ShareComposition'),
    CONSTRAINT value_sharecomp_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_sharecomp_share_is_a_percentage CHECK (share >= 0 AND share <= 100)
);

CREATE TABLE value_boolean (
    value_id   bigint  PRIMARY KEY,
    value_type text    NOT NULL,
    value      boolean NOT NULL,

    CONSTRAINT value_boolean_is_boolean CHECK (value_type = 'Boolean'),
    CONSTRAINT value_boolean_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type)
);

CREATE TABLE value_score (
    value_id    bigint  PRIMARY KEY,
    value_type  text    NOT NULL,
    value       numeric NOT NULL,
    range_min   numeric NOT NULL,
    range_max   numeric NOT NULL,
    assigned_by text    NOT NULL,
    rationale   text,

    CONSTRAINT value_score_is_assignedscore CHECK (value_type = 'AssignedScore'),
    CONSTRAINT value_score_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type),
    CONSTRAINT value_score_range_is_ordered CHECK (range_min < range_max),
    CONSTRAINT value_score_is_within_its_range CHECK (value >= range_min AND value <= range_max),
    CONSTRAINT value_score_assigner_is_known CHECK (assigned_by IN ('llm', 'human'))
);

CREATE TABLE value_text (
    value_id   bigint PRIMARY KEY,
    value_type text   NOT NULL,
    body       text   NOT NULL,

    CONSTRAINT value_text_is_text CHECK (value_type = 'Text'),
    CONSTRAINT value_text_agrees_with_value
        FOREIGN KEY (value_id, value_type) REFERENCES value (id, value_type)
);
