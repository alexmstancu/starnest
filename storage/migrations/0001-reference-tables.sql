-- Reference tables: the fixed, rarely-changing vocabularies everything else points at.
--
-- arch.md 3.2a. An identifier is assigned once and is permanent; a display name may be
-- corrected, translated or re-styled without touching a single row that refers to it.
--
-- Only value_type and confidence_level are seeded here. Both are closed sets the schema's own
-- constraints depend on: a payload table's CHECK names a value_type literal, and the
-- active-value view orders by a confidence rank. Every other reference table is created empty
-- and populated by the catalog migrations.

CREATE TABLE level (
    id           text    PRIMARY KEY,
    depth_order  integer NOT NULL,
    parent_level text    REFERENCES level (id),

    CONSTRAINT level_depth_order_unique  UNIQUE (depth_order),
    CONSTRAINT level_nests_under_another CHECK (parent_level IS DISTINCT FROM id),
    -- Referenceable so a candidate can be checked against the pair (level, parent_level).
    CONSTRAINT level_nesting_key         UNIQUE (id, parent_level)
);

COMMENT ON TABLE level IS
    'The ordered levels. Two ship -- country (1) and city (2) -- but nothing may assume there are exactly two (reqs.md 3.1).';

CREATE TABLE value_type (
    id text PRIMARY KEY
);

COMMENT ON TABLE value_type IS
    'The ten semantic archetypes of reqs.md 3.3a. Adding one is a code change: it needs a payload table.';

INSERT INTO value_type (id) VALUES
    ('Monetary'), ('Quantity'), ('Count'), ('Ratio'), ('Index'),
    ('LabelSet'), ('ShareComposition'), ('Boolean'), ('AssignedScore'), ('Text')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE confidence_level (
    id             text    PRIMARY KEY,
    name           text    NOT NULL,
    -- Lower sorts first, so 1 is the strongest grade. The active-value view (arch.md 4)
    -- breaks ties on this, which is why the four grades need a stored order at all.
    priority_order integer NOT NULL,

    CONSTRAINT confidence_level_priority_order_unique UNIQUE (priority_order)
);

COMMENT ON TABLE confidence_level IS
    'The four grades of reqs.md 5.7. Derived per value from the source tier, then downgraded for age, geography and derivation.';

INSERT INTO confidence_level (id, name, priority_order) VALUES
    ('absolute', 'Absolute', 1),
    ('high',     'High',     2),
    ('medium',   'Medium',   3),
    ('low',      'Low',      4)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE unit (
    id   text PRIMARY KEY,
    name text NOT NULL
);

COMMENT ON TABLE unit IS
    'Units a Quantity may carry -- celsius, km, mbps, hours_per_year (arch.md 3.2a).';

CREATE TABLE currency (
    id   text PRIMARY KEY,
    name text NOT NULL,

    CONSTRAINT currency_is_iso_4217 CHECK (id ~ '^[A-Z]{3}$')
);

COMMENT ON TABLE currency IS
    'Currencies a Monetary may carry, by ISO 4217 code.';

CREATE TABLE label_vocabulary (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    description text
);

COMMENT ON TABLE label_vocabulary IS
    'Named controlled vocabularies for LabelSet attributes -- Koeppen zone codes and the like (arch.md 3.2a). Per-attribute vocabularies live in attribute_allowed_label.';

CREATE TABLE data_source (
    id               text    PRIMARY KEY,
    name             text    NOT NULL,
    source_kind      text    NOT NULL,
    -- Rank in the global source order of reqs.md 6.6. Lower is higher priority.
    default_priority integer NOT NULL,
    reliability_tier text    NOT NULL,

    CONSTRAINT data_source_kind_is_known CHECK (source_kind IN ('structured', 'llm', 'manual'))
);

COMMENT ON TABLE data_source IS
    'Where values come from. Manual entry and the LLM are sources like any other (reqs.md 3.5).';

CREATE TABLE breakdown_scheme (
    id text PRIMARY KEY
);

COMMENT ON TABLE breakdown_scheme IS
    'What a multi-value attribute is broken down BY -- bedroom_count, occupancy (reqs.md 3.3b).';

CREATE TABLE breakdown_option (
    id               text PRIMARY KEY,
    breakdown_scheme text NOT NULL REFERENCES breakdown_scheme (id)
);

COMMENT ON TABLE breakdown_option IS
    'One case within a scheme -- two_bedroom, three_people. A controlled vocabulary, so a typo cannot invent an option.';

CREATE TABLE household_field (
    id text PRIMARY KEY
);

COMMENT ON TABLE household_field IS
    'The household numbers a compound rule may read, as a controlled vocabulary so a rule cannot name a field that does not exist (reqs.md 3.7a).';

CREATE TABLE fx_rate (
    base_currency  text    NOT NULL REFERENCES currency (id),
    quote_currency text    NOT NULL REFERENCES currency (id),
    rate_date      date    NOT NULL,
    rate           numeric NOT NULL,
    data_source    text    NOT NULL REFERENCES data_source (id),

    -- One rate per pair per day, so two values converted hours apart carry the same figure
    -- and a cost comparison cannot go quietly wrong (reqs.md 5.5).
    CONSTRAINT fx_rate_pkey            PRIMARY KEY (base_currency, quote_currency, rate_date),
    CONSTRAINT fx_rate_pair_differs    CHECK (base_currency <> quote_currency),
    CONSTRAINT fx_rate_is_positive     CHECK (rate > 0)
);

COMMENT ON TABLE fx_rate IS
    'The exchange rate a monetary conversion used, with the source that published it. The rate is data, not an implementation detail (reqs.md 5.5).';
