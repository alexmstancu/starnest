-- A criterion may only be scored when its attribute carries a figure that can be compared.
--
-- Six of the ten value types carry a comparable number. The other four do not, and that is not
-- a gap: a Koeppen climate zone, a set of treaty partners, a share composition and a paragraph
-- of prose are facts worth displaying and worth matching against a threshold, but there is no
-- arithmetic that puts `Cfb` above `Dfb` (reqs.md 3.3a). Scoring one would mean inventing an
-- order nobody published.
--
-- The shipped criteria set asked for exactly that. Three criteria over LabelSet attributes --
-- climate_zone, remote_work_tax_treaty and international_employers -- carried is_scored = true
-- and 68 weight-points between them. `evaluation/magnitudes.py` refuses to read a LabelSet, so
-- their weight would redistribute away on every candidate for ever, and the coverage figure
-- would report it as MISSING DATA. The figure is not missing. It is not a number.
--
-- Invisible until something tried, which nothing did until `evaluation/` existed. This is what
-- a defect looks like when the code that would have noticed it had not been written yet.
--
-- Excluding a criterion is not a downgrade (reqs.md 5.3): it still matches, it still gates
-- through a matching threshold, and it still appears in the drill-down. What stops is the
-- application claiming it can score a climate zone.
--
-- The constraint is added as well as the rows corrected, because the same mistake is available
-- to every future criteria set and a catalog migration is exactly where it would be made again.
-- depends: 0121-minimal-criteria-set

UPDATE criterion AS c
SET    is_scored = false
FROM   attribute AS a
WHERE  a.id = c.attribute
  AND  c.is_scored
  AND  a.value_type IN ('LabelSet', 'ShareComposition', 'Boolean', 'Text');

-- The value type is already restated on the criterion (0009) so that a threshold child can be
-- pinned to it, which means this check needs no join.
ALTER TABLE criterion
    ADD CONSTRAINT criterion_scores_only_a_comparable_figure
        CHECK (NOT is_scored
               OR value_type IN ('Monetary', 'Quantity', 'Count', 'Ratio', 'Index',
                                 'AssignedScore'));
