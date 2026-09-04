-- A criterion may only judge an attribute that belongs to a pillar.
--
-- reqs.md 3.3 says an attribute with no criterion attached is descriptive and never scored.
-- Nothing enforced the other direction: a criterion could be attached to an attribute whose
-- pillar is NULL, and the schema was perfectly happy to store it. The failure arrived much
-- later and somewhere else -- evaluation_criterion.pillar is NOT NULL, so the crash came at
-- SAVE time, after a ranking had been computed, displayed and read. A number the user has
-- already acted on, refused on its way to disk, is the worst order in which to discover this.
--
-- The fix restates the pillar on the criterion, exactly as value_type is already restated
-- three columns above it and for the identical reason: it turns the link to the attribute into
-- a composite key, and a composite key is something the database can check. An attribute with
-- a NULL pillar has no (id, pillar) row for a NOT NULL pillar to match, so the criterion
-- becomes unwritable rather than unsaveable.
--
-- The domain object was already there. `criteria/criterion.py` declares `pillar: PillarId`,
-- non-optional, and openapi.yaml's `Criterion` requires it. Only the table was behind.
--
-- The cost, stated plainly: moving an attribute to a different pillar must now update its
-- criteria too, or the foreign key refuses. That migration was never mechanical anyway --
-- weights sum to 100 within a pillar (reqs.md 5.2), so moving an attribute breaks the sum on
-- both sides and has to decide what each set does about it.
--
-- NUMBERED AFTER THE CATALOG, not in the schema block with the table it alters. 0104 seeds 41
-- criteria and supplies no pillar, so a NOT NULL column added before it would fail on a fresh
-- database while succeeding on an existing one -- the worst kind of migration, which passes
-- here and breaks on a rebuild. A constraint on seeded rows runs after the seed that makes
-- them.
-- depends: 0105-catalog-household-fields

-- Referenceable, so the criterion below can be pinned to it. `id` is already the primary key,
-- so this adds no restriction on `attribute`; it exists only to be the target of a key.
ALTER TABLE attribute
    ADD CONSTRAINT attribute_pillar_key UNIQUE (id, pillar);

ALTER TABLE criterion ADD COLUMN pillar text;

-- The 41 seeded criteria take the pillar their attribute already declares. This is a copy of
-- what the read path was computing by join, so no criterion changes pillar here.
UPDATE criterion
SET    pillar = attribute.pillar
FROM   attribute
WHERE  attribute.id = criterion.attribute;

ALTER TABLE criterion ALTER COLUMN pillar SET NOT NULL;

ALTER TABLE criterion
    ADD CONSTRAINT criterion_judges_an_attribute_with_a_pillar
        FOREIGN KEY (attribute, pillar) REFERENCES attribute (id, pillar);

COMMENT ON COLUMN criterion.pillar IS
    'The pillar of the attribute this criterion judges, restated so the link is a composite key. A pillar-less attribute is descriptive and cannot be scored (reqs.md 3.3).';
