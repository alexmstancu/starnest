-- Parental leave becomes scoreable: the attribute says what it now measures, and both shipped
-- sets get the two anchors that let `fixed` read it.
--
-- OECD's Family Database Table PF2.1.A publishes two columns for the same entitlement. Column
-- (7) is raw length -- Czechia 164 weeks, Finland 161. Column (9) is the full-rate equivalent:
-- the same leave discounted by what it actually pays. Czechia's 164 weeks pay 31% of earnings
-- and come to 50.6 full-pay weeks; Estonia's 82 weeks pay 100% and come to 82.1. Raw length
-- calls Czechia twice as generous as Estonia, and it is not.
--
-- **The household chose the full-rate equivalent on 2026-09-19**, so the description has to
-- stop saying "weeks paid" -- which reads as column (7) and is what the transcription used
-- until today. The unit stays `weeks`, because a full-rate equivalent week is a week.
--
-- **It is still an attribute, not an ExternalScore** (Q223). Length and payment rate are two
-- facets of one thing, the leave a family receives, so combining them is measurement
-- methodology rather than somebody's view of what matters -- the same reading that keeps a
-- price level index an attribute.
--
-- The anchors: 8 -> 0 and 90 -> 100, against a field running from Switzerland's 8.05 to
-- Romania's 88.68. **Rounded outward on purpose.** Anchoring on the observed extremes exactly
-- would make 0 and 100 move whenever a figure is refreshed, which is a percentile wearing a
-- fixed scale's clothes; rounding just outside the field keeps the scale absolute while still
-- letting nobody pile up at either end.
--
-- Both shipped sets get them. They disagree about weights, not about what a week of paid leave
-- is worth measuring on.
--
-- depends: 0474-cheap-but-taxed-is-decided

UPDATE attribute
SET    description = 'full-rate equivalent weeks of paid leave available to mothers: length discounted by its payment rate (OECD Family Database PF2.1.A, column 9)'
WHERE  id = 'country.parental_leave_policy';

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, a.input_value, a.score
FROM   criterion c
CROSS  JOIN (VALUES (8, 0), (90, 100)) AS a(input_value, score)
WHERE  c.attribute = 'country.parental_leave_policy';

-- A `fixed` criterion needs two anchors before it can score anything, and an attribute whose
-- description contradicts its figures is how the next reader ships the wrong column. Both are
-- asserted, because either one alone leaves the criterion looking answered and scoring nothing.
DO $$
DECLARE
    unanchored  integer;
    described   integer;
BEGIN
    SELECT count(*) INTO unanchored
    FROM   criterion c
    WHERE  c.attribute = 'country.parental_leave_policy'
      AND  (SELECT count(*) FROM criterion_scale_anchor a WHERE a.criterion = c.id) < 2;

    SELECT count(*) INTO described
    FROM   attribute
    WHERE  id = 'country.parental_leave_policy' AND description LIKE 'full-rate equivalent%';

    IF unanchored <> 0 THEN
        RAISE EXCEPTION '% parental-leave criteria still have fewer than two anchors', unanchored;
    END IF;
    IF described <> 1 THEN
        RAISE EXCEPTION 'country.parental_leave_policy does not say it measures the full-rate equivalent';
    END IF;
END $$;
