-- European air connectivity stops being scored, one day after it started. Decided by the
-- household on 2026-09-13 (Q228), against the first real figures.
--
-- **The figure is right and scoring it would be wrong.** Fetched live for all 31 candidates
-- with an airport, it spans **28 to 34** and takes six distinct values: Estonia 28, Iceland and
-- Slovenia 29, most of Europe 32 or 33, the United Kingdom 34. **Malta ties Germany.** At
-- country granularity within Europe the question "can you fly there" is answered yes for almost
-- everyone, and the ceiling Eurostat's own partner list imposes is 35.
--
-- Scoring it would turn that into rank differences: under `percentile` Estonia's 28 against
-- Latvia's 31 becomes a visible connectivity gap, and under any `fixed` anchoring the same
-- three-point noise decides places. **A plausible-looking number is the failure this
-- application exists to prevent** (reqs.md 10), and this is one -- not because it is
-- inaccurate, but because it is not a distinction.
--
-- **So it becomes descriptive**, which is the category reqs.md 3.0 already has for exactly
-- this: "an attribute with no criterion attached is descriptive and never scored". It keeps its
-- pillar, its source and its provenance; the value is fetched, stored and displayed as context
-- beside the country. Nothing is deleted, and adding a criterion later is a data change.
--
-- **The international measure gets its whole weight back**, since it is again the only air
-- criterion in the pillar. `0470` split it only to stop the pair counting twice.
-- depends: 0470-european-air-connectivity

DELETE FROM criterion WHERE attribute = 'country.european_air_connectivity';

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 25),
    ('remote_only',      30)
) AS declared (criteria_set, weight)
WHERE  criterion.attribute = 'country.international_air_connectivity'
  AND  criterion.criteria_set = declared.criteria_set;

-- The guard `0469` and `0470` carry, for the third time and the same reason: a pillar that does
-- not sum to 100 produces a ranking computed from the wrong total rather than an error anybody
-- sees. Rounded, because `numeric` keeps a rebalance's last digits where Python's `Decimal`
-- drops them (`known-issues.md` P33).
DO $$
DECLARE
    offending text;
BEGIN
    SELECT string_agg(criteria_set || '.' || pillar || ' = ' || total, ', ')
    INTO   offending
    FROM   (SELECT criteria_set, pillar, SUM(weight) AS total
            FROM   criterion
            GROUP  BY criteria_set, pillar) AS sums
    WHERE  round(total, 10) <> 100;

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'criterion weights no longer sum to 100: %', offending;
    END IF;
END $$;
