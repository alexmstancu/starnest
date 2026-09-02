-- Band labels: the word a number displays as, without ceasing to be a number.
--
-- reqs.md 5.1 requires them and openapi.yaml carries them on every anchor. Neither anchor
-- table had a column for one, so a requirement that both the specification and the contract
-- state could not be stored -- the anchors would round-trip through the API and lose their
-- labels silently.
--
-- Nullable, because a label is optional per anchor: `country.economic_outlook` labels all five
-- of its bands, while a rent scale may label none of them. Adding it as a column rather than a
-- lookup table because a band label is display text belonging to one anchor of one criterion,
-- not a vocabulary shared between criteria -- "affordable" on a rent scale and "affordable" on
-- a childcare scale are different words that happen to be spelled alike.
--
-- The label goes on the LOWER edge of the band it names: an anchor at 500 EUR labelled
-- `affordable` means everything from 500 up to the next anchor reads as affordable. Stated
-- here because a label attached to a single point rather than to a span would be the obvious
-- misreading, and nothing in the column name says which.
-- depends: 0012-indexes

ALTER TABLE criterion_scale_anchor ADD COLUMN label text;

COMMENT ON COLUMN criterion_scale_anchor.label IS
    'The word this band displays as -- affordable, stretching, growth. Names the span from this anchor up to the next (reqs.md 5.1).';

-- The frozen twin. An evaluation records the interpretation that produced its scores
-- (reqs.md Q193), and a band label is part of that interpretation: re-reading an old
-- evaluation must show the words it showed then, even if the criterion has since been
-- relabelled.
ALTER TABLE evaluation_scale_anchor ADD COLUMN label text;

COMMENT ON COLUMN evaluation_scale_anchor.label IS
    'The band label frozen with the evaluation, so an old reading still displays the words it displayed then.';
