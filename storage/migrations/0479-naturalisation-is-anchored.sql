-- `naturalisation_pathway` gets the two anchors that let `fixed` read it.
--
-- **Five years to ten, and the extremes are the anchors.** Every jurisdiction on the roster
-- requires 5, 7, 8 or 10 years of lawful residence for ordinary naturalisation -- nine at five,
-- three at seven, nine at eight, eleven at ten. Four distinct values, but unlike
-- `statutory_paid_leave` this is not a floor everyone legislates and a handful exceed: the
-- distribution is genuinely spread, and the gap between the ends is half a decade of somebody's
-- life. That is a distinction worth scoring.
--
-- So 5 -> 100 and 10 -> 0, with the goal already `minimise`. The two numbers are the observed
-- legal extremes and are round by law rather than by choice, which is why they are used
-- directly: there is nothing between them to invent, and anchoring wider would compress a real
-- difference to make room for countries that do not exist.
--
-- **Overrulable like every anchor** (Q206): they are the household's judgement about what five
-- years versus ten is worth, and changing them is a migration, not a code change.
--
-- depends: 0478-school-quality-is-a-quantity

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, a.input_value, a.score
FROM   criterion c
CROSS  JOIN (VALUES (5, 100), (10, 0)) AS a(input_value, score)
WHERE  c.attribute = 'country.naturalisation_pathway';

DO $$
DECLARE
    unanchored integer;
BEGIN
    SELECT count(*) INTO unanchored
    FROM   criterion c
    WHERE  c.attribute = 'country.naturalisation_pathway'
      AND  (SELECT count(*) FROM criterion_scale_anchor a WHERE a.criterion = c.id) < 2;

    IF unanchored <> 0 THEN
        RAISE EXCEPTION '% naturalisation criteria still have fewer than two anchors', unanchored;
    END IF;
END $$;
