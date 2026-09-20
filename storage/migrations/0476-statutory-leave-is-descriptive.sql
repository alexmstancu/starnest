-- Statutory paid leave stops being scored, the day its first figures landed. Decided by the
-- household on 2026-09-20, against those figures rather than in the abstract.
--
-- **The figures are right and scoring them would be wrong.** Transcribed for 31 of the 32
-- candidates, they take **seven distinct values between 20 and 28 working days, and eighteen
-- countries sit on exactly 20**. That is not a coincidence: the EU Working Time Directive sets
-- four weeks as the floor, so most of the continent legislates the floor and the spread is what
-- a handful of countries chose to add.
--
-- Scoring it would turn an eight-day legal difference into the whole scale. Anchored on the
-- observed range, eighteen countries score zero for obeying the law -- which reads as "no paid
-- leave" and is false. Under `percentile` the eighteen tie and the ranking is decided by which
-- of them the sort happens to put first.
--
-- **This is Q228 a second time**, on the same evidence and with the same answer: "a figure can
-- be right and still not worth scoring". `european_air_connectivity` spanned 28 to 34 with six
-- distinct values and became descriptive (`0471`); this spans 20 to 28 with seven. The category
-- is `reqs.md` 3.0's own -- an attribute with no criterion attached is descriptive and never
-- scored. It keeps its pillar, its source and its provenance, the figures stay stored and
-- displayed as context, and attaching a criterion later is a data change.
--
-- **The freed weight goes back to career in proportion**, rather than to one sibling: unlike
-- `0471`, where one air criterion was left and could simply take the pair's whole share, career
-- has five other criteria and no reason to prefer any of them.
--
-- depends: 0475-parental-leave-is-measured-and-anchored

UPDATE criterion
SET    weight = weight * 100 / (
           SELECT SUM(sibling.weight)
           FROM   criterion AS sibling
           WHERE  sibling.criteria_set = criterion.criteria_set
             AND  sibling.pillar = 'career'
             AND  sibling.attribute <> 'country.statutory_paid_leave')
WHERE  criterion.pillar = 'career'
  AND  criterion.attribute <> 'country.statutory_paid_leave'
  AND  criterion.criteria_set IN (
           SELECT criteria_set FROM criterion
           WHERE attribute = 'country.statutory_paid_leave');

DELETE FROM criterion WHERE attribute = 'country.statutory_paid_leave';

-- The guard `0469` through `0471` carry, for the fourth time and the same reason: a pillar that
-- does not sum to 100 produces a ranking computed from the wrong total rather than an error
-- anybody sees. Rounded, because `numeric` keeps a rebalance's last digits where Python's
-- `Decimal` drops them (`known-issues.md` P33).
DO $$
DECLARE
    offending text;
    still_scored integer;
BEGIN
    SELECT string_agg(criteria_set || '.' || pillar || ' = ' || total, ', ')
    INTO   offending
    FROM   (SELECT criteria_set, pillar, SUM(weight) AS total
            FROM   criterion
            GROUP  BY criteria_set, pillar) AS sums
    WHERE  round(total, 10) <> 100;

    SELECT count(*) INTO still_scored
    FROM   criterion WHERE attribute = 'country.statutory_paid_leave';

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'criterion weights no longer sum to 100: %', offending;
    END IF;
    IF still_scored <> 0 THEN
        RAISE EXCEPTION 'statutory_paid_leave is still scored by % set(s)', still_scored;
    END IF;
END $$;
