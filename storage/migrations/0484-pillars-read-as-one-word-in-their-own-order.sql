-- Eleven pillars, one word each, in the order a person weighs them.
--
-- **Both halves are presentation, and both are data.** The design writes every pillar as a
-- single word and puts them in a deliberate order -- Economy, Housing, Career first, because
-- that is the order the question gets asked -- and the Rank table's eleven columns are where
-- that order does its work: a candidate's shape is readable left to right only if the columns
-- mean something in sequence. Alphabetical opens with Career, Climate, Connectivity, which
-- reads as a list rather than as a priority.
--
-- **A column, not an array in the client.** Pillars are rows, and an ordered list of their
-- names living in a `.tsx` is precisely what the "nothing hardcoded" invariant exists to
-- prevent (`arch.md` 1.2). The order is a fact about the catalog and belongs beside the names.
--
-- **`name` is display only.** Nothing joins on it, nothing stores it; every reference is by
-- `pillar.id`, which does not change here. `connectivity` stays `connectivity`.
ALTER TABLE pillar ADD COLUMN display_order integer;

UPDATE pillar SET name = 'Economy',    display_order = 1  WHERE id = 'economics';
UPDATE pillar SET name = 'Housing',    display_order = 2  WHERE id = 'housing';
UPDATE pillar SET name = 'Career',     display_order = 3  WHERE id = 'career';
UPDATE pillar SET name = 'Safety',     display_order = 4  WHERE id = 'safety';
UPDATE pillar SET name = 'Health',     display_order = 5  WHERE id = 'health';
UPDATE pillar SET name = 'Climate',    display_order = 6  WHERE id = 'climate';
-- The design's word for this one is Transport. It also holds broadband coverage, so the name
-- is narrower than the pillar -- recorded in `docs/design-brief.md` rather than quietly
-- corrected here, because the name is the design's to choose and the mismatch is ours to raise.
UPDATE pillar SET name = 'Transport',  display_order = 7  WHERE id = 'connectivity';
UPDATE pillar SET name = 'Nature',     display_order = 8  WHERE id = 'nature';
UPDATE pillar SET name = 'Culture',    display_order = 9  WHERE id = 'culture';
UPDATE pillar SET name = 'Governance', display_order = 10 WHERE id = 'governance';
UPDATE pillar SET name = 'Family',     display_order = 11 WHERE id = 'family';

-- Refuses a pillar added later with no place in the order, which would otherwise sort
-- arbitrarily and silently -- the failure this column exists to remove.
ALTER TABLE pillar ALTER COLUMN display_order SET NOT NULL;

-- Two pillars cannot claim one slot. Without this the order is only mostly defined, and
-- "mostly defined" means it changes when the planner feels like it.
-- depends: 0483-a-run-can-be-stopped
ALTER TABLE pillar ADD CONSTRAINT pillar_display_order_is_unique UNIQUE (display_order);
