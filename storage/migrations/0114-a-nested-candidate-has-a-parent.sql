-- A candidate at a level that nests under another must actually name its parent.
--
-- `candidate_nesting_is_declared` and `candidate_parent_is_at_parent_level` both key on
-- `parent_level`, and both are MATCH SIMPLE -- so a NULL skips them entirely. Combined with
-- `candidate_parent_is_all_or_nothing`, which only says the two parent columns agree with each
-- other, a city with no parent_level and no parent_candidate satisfies every constraint on the
-- table. `city.orphan`, belonging to no country, inserts (known-issues D11).
--
-- **MATCH FULL is not the fix**, though it is the obvious guess and known-issues suggested it.
-- `level` is NOT NULL, so under MATCH FULL the pair (level, parent_level) would never be
-- entirely null and every COUNTRY would be rejected -- a country's parent_level is legitimately
-- absent. The rule is not "both or neither"; it is "a parent is required exactly when this
-- candidate's level declares a parent level", and that is a fact about a row in another table.
--
-- So the fact comes to where a CHECK can see it, by the same composite-key trick this schema
-- uses for candidate.parent_level, criterion.value_type and criterion.pillar. `level` gains a
-- generated flag, the candidate carries a copy pinned to it by foreign key, and a plain CHECK
-- then reads it.
--
-- Nothing here names `country` or `city`. Levels are ordered records and no code may assume
-- there are exactly two (reqs.md 3.1); a third level would get the flag computed for it like
-- the other two.
-- depends: 0113-external-scores-span-a-period

-- Derived, never set: a level requires a parent exactly when it declares one to nest under.
-- Generated so the two cannot disagree, and STORED so it can be referenced.
ALTER TABLE level
    ADD COLUMN requires_parent boolean
        GENERATED ALWAYS AS (parent_level IS NOT NULL) STORED;

ALTER TABLE level ADD CONSTRAINT level_parenthood_key UNIQUE (id, requires_parent);

COMMENT ON COLUMN level.requires_parent IS
    'Whether a candidate at this level must name a parent. Derived from parent_level so the two can never disagree (reqs.md 3.1).';

ALTER TABLE candidate ADD COLUMN parent_required boolean;

-- The 32 seeded countries sit at the shallowest level and require no parent. Copied from the
-- level rather than assumed, so this is correct for any level that may be seeded later.
UPDATE candidate AS c
SET    parent_required = l.requires_parent
FROM   level AS l
WHERE  l.id = c.level;

ALTER TABLE candidate ALTER COLUMN parent_required SET NOT NULL;

ALTER TABLE candidate
    ADD CONSTRAINT candidate_knows_whether_its_level_needs_a_parent
        FOREIGN KEY (level, parent_required) REFERENCES level (id, requires_parent);

-- The point of all of the above. A nested level's candidate names its parent, or it does not
-- go in.
ALTER TABLE candidate
    ADD CONSTRAINT candidate_at_a_nested_level_names_its_parent
        CHECK (NOT parent_required OR parent_candidate IS NOT NULL);

COMMENT ON COLUMN candidate.parent_required IS
    'Whether this candidate''s level nests under another, copied from the level and pinned to it, so that a CHECK can require a parent without naming any level.';
