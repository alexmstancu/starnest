-- The places under evaluation, and the hierarchy between them.
-- depends: 0001-reference-tables

CREATE TABLE candidate (
    id               text PRIMARY KEY,
    name             text NOT NULL,
    level            text NOT NULL REFERENCES level (id),
    -- The level the parent must be at, taken from level.parent_level.
    parent_level     text,
    parent_candidate text,

    -- Referenceable so a child can be checked against its parent's level.
    CONSTRAINT candidate_level_key UNIQUE (id, level),

    -- The hierarchy is enforced, not assumed (reqs.md 3.1). These two foreign keys together
    -- make a city recorded as the parent of another city impossible to insert: the pair
    -- (level, parent_level) must be one the level table declares, and the parent candidate
    -- must actually sit at that parent level.
    CONSTRAINT candidate_nesting_is_declared
        FOREIGN KEY (level, parent_level) REFERENCES level (id, parent_level),
    CONSTRAINT candidate_parent_is_at_parent_level
        FOREIGN KEY (parent_candidate, parent_level) REFERENCES candidate (id, level),

    CONSTRAINT candidate_parent_is_all_or_nothing
        CHECK ((parent_candidate IS NULL) = (parent_level IS NULL)),
    CONSTRAINT candidate_is_not_its_own_parent
        CHECK (parent_candidate IS DISTINCT FROM id)
);

COMMENT ON TABLE candidate IS
    'A country or a city. Identifiers are country.portugal and city.portugal.lisbon -- readable, assigned once, never regenerated from the name (arch.md 3.2).';
COMMENT ON COLUMN candidate.name IS
    'The short display label. The official name and local alternates are descriptive attributes, sourced and dated like any other fact.';
