-- Pillars, attributes and their per-attribute declarations.
--
-- The catalog is data in the database, not a config file (arch.md 1.2): adding an attribute
-- inserts rows and never alters a table.
-- depends: 0002-candidates

CREATE TABLE pillar (
    id          text PRIMARY KEY,
    level       text NOT NULL REFERENCES level (id),
    name        text NOT NULL,
    description text,

    -- Referenceable so an attribute can be checked to sit in a pillar of its own level.
    CONSTRAINT pillar_level_key UNIQUE (id, level)
);

COMMENT ON TABLE pillar IS
    'A load-bearing vertical of a life. Eleven at each level. A pillar says which vertical a thing belongs to; its weight is a property of a criteria set, not of the pillar (reqs.md 3.2).';

CREATE TABLE attribute (
    id               text PRIMARY KEY,
    -- Null for descriptive attributes, which ship with no criterion and are never scored.
    pillar           text,
    level            text NOT NULL REFERENCES level (id),
    value_type       text NOT NULL REFERENCES value_type (id),
    breakdown_scheme text REFERENCES breakdown_scheme (id),
    name             text NOT NULL,
    description      text,
    -- How quickly this kind of data goes stale. Objective: rent ages in months whoever asks.
    max_age          interval,
    manual_entry     boolean NOT NULL DEFAULT false,
    -- A retired attribute drops out of active scoring while its values keep pointing at a
    -- row that still exists. This is what makes retirement work at all (arch.md 2, 3.2).
    lifecycle_status text NOT NULL DEFAULT 'active',

    -- The catalog's type declaration, made referenceable. This is link 1 of the
    -- type-agreement chain of arch.md 3.3b.
    CONSTRAINT attribute_type_key UNIQUE (id, value_type),

    CONSTRAINT attribute_pillar_is_at_same_level
        FOREIGN KEY (pillar, level) REFERENCES pillar (id, level),
    CONSTRAINT attribute_lifecycle_status_is_known
        CHECK (lifecycle_status IN ('active', 'retired')),
    CONSTRAINT attribute_max_age_is_positive
        CHECK (max_age IS NULL OR max_age > interval '0')
);

COMMENT ON TABLE attribute IS
    'Something knowable about a candidate. Objective: it says what is measured and how fast it goes stale, and nothing about whether more is better (reqs.md 3.3).';
COMMENT ON COLUMN attribute.value_type IS
    'Immutable together with id. Changing an attribute''s type means creating a new attribute and retiring the old one (arch.md 2).';

-- Per-attribute validation beyond what the value type enforces (reqs.md 3.3a). Rent declares
-- > 0; temperature allows negatives. At most one row per attribute, hence the primary key.
CREATE TABLE attribute_allowed_range (
    attribute text PRIMARY KEY REFERENCES attribute (id),
    min_value numeric,
    max_value numeric,

    CONSTRAINT attribute_allowed_range_declares_a_bound
        CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
    CONSTRAINT attribute_allowed_range_is_ordered
        CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE attribute_allowed_label (
    attribute text NOT NULL REFERENCES attribute (id),
    label     text NOT NULL,

    CONSTRAINT attribute_allowed_label_pkey PRIMARY KEY (attribute, label)
);

COMMENT ON TABLE attribute_allowed_label IS
    'The vocabulary a LabelSet attribute may draw from (reqs.md 3.3a).';

-- An override is partial: the sources named here take this order, and every other source
-- keeps its global order beneath them (reqs.md 6.6). The junction is a table, not a JSON
-- list, so "which attributes prefer this source?" is a query.
CREATE TABLE attribute_source_priority (
    attribute   text    NOT NULL REFERENCES attribute (id),
    data_source text    NOT NULL REFERENCES data_source (id),
    rank        integer NOT NULL,

    CONSTRAINT attribute_source_priority_pkey PRIMARY KEY (attribute, data_source),
    CONSTRAINT attribute_source_priority_rank_unique UNIQUE (attribute, rank),
    CONSTRAINT attribute_source_priority_rank_is_positive CHECK (rank > 0)
);

-- Type parameters (reqs.md 3.3): the type-specific half of an attribute's declaration, as
-- typed child tables rather than nullable columns. Each pins its own value_type and joins the
-- attribute through the composite key, so a Ratio attribute cannot be given index bounds.
-- Only the three the documents name exist; a type with nothing to declare gets no table.

CREATE TABLE attribute_quantity_parameter (
    attribute  text PRIMARY KEY,
    value_type text NOT NULL,
    unit       text NOT NULL REFERENCES unit (id),

    CONSTRAINT attribute_quantity_parameter_is_quantity CHECK (value_type = 'Quantity'),
    CONSTRAINT attribute_quantity_parameter_agrees_with_attribute
        FOREIGN KEY (attribute, value_type) REFERENCES attribute (id, value_type)
);

CREATE TABLE attribute_index_parameter (
    attribute  text    PRIMARY KEY,
    value_type text    NOT NULL,
    provider   text    NOT NULL,
    scale_min  numeric NOT NULL,
    scale_max  numeric NOT NULL,

    CONSTRAINT attribute_index_parameter_is_index CHECK (value_type = 'Index'),
    CONSTRAINT attribute_index_parameter_scale_is_ordered CHECK (scale_min < scale_max),
    CONSTRAINT attribute_index_parameter_agrees_with_attribute
        FOREIGN KEY (attribute, value_type) REFERENCES attribute (id, value_type)
);

CREATE TABLE attribute_ratio_parameter (
    attribute  text PRIMARY KEY,
    value_type text NOT NULL,
    -- What the ratio is a share of.
    basis      text NOT NULL,

    CONSTRAINT attribute_ratio_parameter_is_ratio CHECK (value_type = 'Ratio'),
    CONSTRAINT attribute_ratio_parameter_agrees_with_attribute
        FOREIGN KEY (attribute, value_type) REFERENCES attribute (id, value_type)
);
