-- The parent value table and its citations.
--
-- Storage is narrow (arch.md 3.1): values are rows keyed by candidate, attribute and source.
-- There is no countries.population column and there must not be.
-- depends: 0004-data-acquisition

CREATE TABLE value (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate              text NOT NULL REFERENCES candidate (id),
    attribute              text NOT NULL,
    -- Denormalised on purpose. It duplicates what the attribute declares, and that
    -- duplication is the whole mechanism: a two-column foreign key needs both columns on the
    -- referring row. Attribute type is immutable, so the copy can never drift (arch.md 3.3b).
    value_type             text NOT NULL REFERENCES value_type (id),
    data_source            text NOT NULL REFERENCES data_source (id),
    -- Which case this figure describes, for a broken-down attribute. Null otherwise.
    breakdown_option       text REFERENCES breakdown_option (id),
    data_acquisition_run   bigint REFERENCES data_acquisition_run (id),
    -- What period the data describes. Two dates, never one, and never merged with the
    -- retrieval date (reqs.md 3.6). A span in the world, so plain date (arch.md 9.6).
    reference_period_start date NOT NULL,
    reference_period_end   date NOT NULL,
    -- When the app fetched it. A moment the system records, so timestamptz -- never merged
    -- with the reference period above, which is a span in the world (arch.md 9.6).
    retrieval_date         timestamptz NOT NULL,
    confidence_level       text NOT NULL REFERENCES confidence_level (id),
    -- Set when the value failed validation. The only lifecycle state stored on a value:
    -- being active is a comparison between values, so it is computed on read (arch.md 3.4).
    rejection_reason       text,
    quote                  text,

    -- Link 2 of the type-agreement chain (arch.md 3.3b): a value must agree with what its
    -- attribute declared, and must restate its type so a payload can be pinned to it.
    CONSTRAINT value_matches_attribute_type
        FOREIGN KEY (attribute, value_type) REFERENCES attribute (id, value_type),
    CONSTRAINT value_type_key UNIQUE (id, value_type),

    -- The natural key. The three Lisbon rents differ by breakdown_option and are three rows.
    --
    -- BOTH reference dates are in the key, not just the start. A monthly figure for January
    -- and an annual figure for the same year share a start date and differ only in where the
    -- period ends; with only the start in the key the second one would be rejected as a
    -- duplicate of the first, which is a real collision and not a hypothetical one.
    --
    -- retrieval_date stays in the key deliberately. reqs.md 3.6 preserves re-fetches, so a
    -- second fetch of the same period must be a stored observation rather than a constraint
    -- violation. The consequence -- that two fetches seconds apart are two rows -- is
    -- application policy (data_acquisition/ decides when a re-fetch is worth making), not a
    -- fault in the schema.
    -- NULLS NOT DISTINCT is load-bearing, not decoration. `breakdown_option` is NULL for most
    -- values -- only multi-value attributes like rent carry one -- and PostgreSQL's default
    -- treats every NULL as distinct from every other. Without this clause two byte-identical
    -- rows insert happily, and the constraint quietly guarantees nothing for the common case.
    -- Requires PostgreSQL 15 or later; the compose file pins 17.
    CONSTRAINT value_natural_key UNIQUE NULLS NOT DISTINCT (
        candidate, attribute, data_source, breakdown_option,
        reference_period_start, reference_period_end, retrieval_date
    ),

    CONSTRAINT value_reference_period_is_ordered
        CHECK (reference_period_end >= reference_period_start)
);

COMMENT ON TABLE value IS
    'One measurement of one attribute for one candidate from one source. Values are never overwritten and never discarded (reqs.md 3.6).';

CREATE TABLE value_citation (
    value bigint NOT NULL REFERENCES value (id),
    url   text   NOT NULL,

    CONSTRAINT value_citation_pkey PRIMARY KEY (value, url)
);

COMMENT ON TABLE value_citation IS
    'The pages behind a figure. A list, therefore a table -- and where an LLM-sourced value records what it actually read (reqs.md 6.10).';
