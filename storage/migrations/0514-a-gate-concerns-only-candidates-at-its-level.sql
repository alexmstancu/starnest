-- A gate concerns only candidates at its own level (PL-149, NEW-64).
--
-- depends: 0511-a-re-confirmation-names-the-figure-it-restated
--
-- `match_rule_candidate` (0502) named a gate and a candidate through two single-column keys, and
-- nothing tied the candidate's level to the gate's. The level was checked only on read, where a
-- mistake is silent: a country gate whose only row named a city concerns no country at all, so
-- research would ask nobody and its estimate would say nothing was to be asked.
--
-- So the row now carries its gate's level, and two composite keys hold it in the idiom
-- `candidate_level_key` set (0002, 0108, 0460): the gate must be asked at that level, and the
-- candidate must sit at it. **A gate with no level lists no concerned candidates** (D55): such a
-- gate is asked at every level, and "no rows" already says "every candidate". The NOT NULL level
-- matches no gate whose level is NULL, so the foreign key refuses the row -- no trigger.
--
-- **It refuses before changing anything** when a row breaks either rule, and names every
-- offending pair at once. Changing a gate's level later is refused while it lists candidates,
-- which is the point: the migration that moves it re-seeds them.

-- **Locked first** (BE-A1): the check reads both levels and the backfill copies the gate's, so a
-- row, a gate or a candidate changed in between would escape the check or break the keys.
LOCK TABLE match_rule_candidate, match_rule, candidate IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(
               c.match_rule || ' for ' || c.candidate || ' ('
               || CASE WHEN r.level IS NULL
                       THEN 'a gate asked at every level lists nobody'
                       ELSE 'asked of ' || r.level || ', and the candidate is a ' || k.level
                  END || ')',
               '; ' ORDER BY c.match_rule, c.candidate)
    INTO   offenders
    FROM   match_rule_candidate AS c
    JOIN   match_rule AS r ON r.id = c.match_rule
    JOIN   candidate  AS k ON k.id = c.candidate
    WHERE  r.level IS NULL OR r.level <> k.level;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: a gate may concern only candidates at its own level, and %',
            offenders;
    END IF;
END $$;

ALTER TABLE match_rule
    ADD CONSTRAINT match_rule_level_key UNIQUE (id, level);

ALTER TABLE match_rule_candidate
    ADD COLUMN level text;

UPDATE match_rule_candidate AS c
SET    level = r.level
FROM   match_rule AS r
WHERE  r.id = c.match_rule;

ALTER TABLE match_rule_candidate
    ALTER COLUMN level SET NOT NULL;

ALTER TABLE match_rule_candidate
    ADD CONSTRAINT match_rule_candidate_is_asked_at_its_gate_s_level
        FOREIGN KEY (match_rule, level) REFERENCES match_rule (id, level);

ALTER TABLE match_rule_candidate
    ADD CONSTRAINT match_rule_candidate_sits_at_its_gate_s_level
        FOREIGN KEY (candidate, level) REFERENCES candidate (id, level);

COMMENT ON COLUMN match_rule_candidate.level IS
    'The gate''s level, which the candidate must share. A gate asked at every level lists no candidates (D55).';

DO $$
DECLARE
    shipped integer;
BEGIN
    SELECT count(*) INTO shipped
    FROM   match_rule_candidate
    WHERE  (match_rule, candidate) IN (
               ('uk_skilled_worker', 'country.united_kingdom'),
               ('ch_eu_efta_quota',  'country.switzerland'),
               ('li_eea_quota',      'country.liechtenstein'))
    AND    level = 'country';

    IF shipped <> 3 THEN
        RAISE EXCEPTION
            'expected the 3 shipped gates each to concern its country at country level, found %',
            shipped;
    END IF;
END $$;
