-- Let a criterion judge a pillar-less attribute again.
--
-- The column goes with the constraint. Nothing is lost that cannot be recomputed: every value
-- in it was copied from the attribute it names, and the read path still joins for it.

ALTER TABLE criterion DROP CONSTRAINT criterion_judges_an_attribute_with_a_pillar;

ALTER TABLE criterion DROP COLUMN pillar;

ALTER TABLE attribute DROP CONSTRAINT attribute_pillar_key;
