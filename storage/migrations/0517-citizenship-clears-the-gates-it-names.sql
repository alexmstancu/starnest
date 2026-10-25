-- A citizenship clears the gates it names, and EU free movement is derived from one (PL-164,
-- UF-029, G-S6, D59).
--
-- depends: 0525-a-day-without-a-rate-remembers-the-ecbs-answer
--
-- The household's citizenships reached no gate. A British passport did not clear the UK Skilled
-- Worker route, and nothing derived `eu_free_movement`, so that enforced gate never fired for
-- anybody (reqs.md 7.3: "Automatic while that citizenship is EU"). Which citizenship clears which
-- gate is a fact about the law, so it is **catalog data, never code** (arch.md 1.2):
--
-- 1. `match_rule_clearing_citizenship`: a household holding one of these clears the gate wherever
--    the gate asks. Seeded only where a source says so:
--      - `eu_free_movement` <- each of the 27 EU member states: TFEU Art. 21 and 45, and reqs.md
--        7.3, "Automatic while that citizenship is EU".
--      - `eu_free_movement` <- Iceland, Liechtenstein and Norway: the EEA Agreement, Art. 28,
--        extends the free movement of workers to EEA nationals in every EU and EEA state.
--      - `eu_free_movement` <- Switzerland: the Agreement between the EU and the Swiss
--        Confederation on the Free Movement of Persons (1999, in force 2002) grants Swiss
--        nationals the right of entry, residence and work in the EU states, and the EFTA
--        Convention (Annex K) in Iceland, Liechtenstein and Norway.
--      - `uk_skilled_worker` <- the United Kingdom and Ireland: the design's README, "Citizenship
--        drives the citizenship gates", and DECISIONS R5 ("hold a British or Irish passport and the
--        UK skilled-worker gate stops applying"); a British citizen has the right of abode, and an
--        Irish one the Common Travel Area.
--      - `ch_eu_efta_quota` <- Switzerland: the same two design sources; a citizen needs no permit
--        in their own country.
--      - `li_eea_quota` <- Liechtenstein: a citizen needs no residence permit in their own
--        country, so the quota never applies to one.
--      - `not_manually_excluded`, `two_role_feasibility`: nothing. Neither is about a country's
--        own nationals or a passport at all.
-- 2. `match_rule.decided_by_citizenship`: a gate the household's citizenships decide outright --
--    reqs.md 7.3's "Definitional" source, `eu_free_movement` alone. Where none of the household's
--    citizenships clears it, it does not match, with no recorded answer. Never researchable.
-- 3. `eu_free_movement` concerns the 30 EU and EEA states (reqs.md 7.3, "The candidate is an EU
--    or EEA state"), so it is never derived for the United Kingdom or Switzerland, whose own gates
--    ask about them.
-- 4. `match_rule_answer_citizenship`: the citizenships each answer assumed, copied from the
--    household when the version is written, and `match_rule_answer.citizenships_recorded`. An
--    answer is flagged for a re-check on read when the household's citizenships differ -- never
--    expired and never overwritten (household policy 2026-10-13). **A version written before this
--    recorded none**: its assumption is unknown, so it is flagged whenever the household holds a
--    citizenship, because an unknown assumption cannot be shown to match.
-- 6. `match_rule_answer.beside_answer`: the live answer a re-check's proposal was stored beside
--    (D53). A proposal is pending while that answer is still live, which no clock can get wrong:
--    `recorded_at` is each transaction's start, so a person's answer begun before a proposal and
--    committed after it read as older and left the proposal pending beside it. Backfilled for the
--    proposals already stored by the time order they were read by until now.
-- 5. A saved ranking keeps a refusal or warning decided by citizenship, which reads no recorded
--    answer: `decided_by_citizenship` on `non_match_reason` and `candidate_gate_warning`, and the
--    citizenships it was decided on in `evaluation_citizenship`.
--
-- **It refuses before changing anything** when a gate or country it names is missing, naming
-- every one at once.

-- **Locked first** (BE-A1): the seed reads the catalog, and the new constraints read rows a
-- concurrent writer could add between the check and the change.
LOCK TABLE match_rule, match_rule_candidate, candidate, non_match_reason, candidate_gate_warning,
           match_rule_answer, match_rule_result
    IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE clearing_seed (
    match_rule  text NOT NULL,
    citizenship text NOT NULL
);

INSERT INTO clearing_seed (match_rule, citizenship)
SELECT 'eu_free_movement', member
FROM   unnest(ARRAY[
           'country.austria', 'country.belgium', 'country.bulgaria', 'country.croatia',
           'country.cyprus', 'country.czechia', 'country.denmark', 'country.estonia',
           'country.finland', 'country.france', 'country.germany', 'country.greece',
           'country.hungary', 'country.ireland', 'country.italy', 'country.latvia',
           'country.lithuania', 'country.luxembourg', 'country.malta', 'country.netherlands',
           'country.poland', 'country.portugal', 'country.romania', 'country.slovakia',
           'country.slovenia', 'country.spain', 'country.sweden']) AS member;

CREATE TEMP TABLE free_movement_area (candidate text NOT NULL);

INSERT INTO free_movement_area (candidate)
SELECT citizenship FROM clearing_seed WHERE match_rule = 'eu_free_movement'
UNION ALL
SELECT unnest(ARRAY['country.iceland', 'country.liechtenstein', 'country.norway']);

INSERT INTO clearing_seed (match_rule, citizenship) VALUES
    ('eu_free_movement',  'country.iceland'),
    ('eu_free_movement',  'country.liechtenstein'),
    ('eu_free_movement',  'country.norway'),
    ('eu_free_movement',  'country.switzerland'),
    ('uk_skilled_worker', 'country.united_kingdom'),
    ('uk_skilled_worker', 'country.ireland'),
    ('ch_eu_efta_quota',  'country.switzerland'),
    ('li_eea_quota',      'country.liechtenstein');

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(absent.named, ', ' ORDER BY absent.named) INTO missing
    FROM (
        SELECT DISTINCT 'gate ' || s.match_rule AS named
        FROM   clearing_seed AS s
        WHERE  NOT EXISTS (SELECT 1 FROM match_rule AS r WHERE r.id = s.match_rule)
        UNION
        SELECT 'candidate ' || named.id
        FROM   (SELECT citizenship AS id FROM clearing_seed
                UNION SELECT candidate FROM free_movement_area) AS named
        WHERE  NOT EXISTS (SELECT 1 FROM candidate AS c
                           WHERE c.id = named.id AND c.level = 'country')
    ) AS absent;

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: this names %, which the catalog does not have', missing;
    END IF;
END $$;

-- 1. Which citizenships clear which gate.
CREATE TABLE match_rule_clearing_citizenship (
    match_rule text NOT NULL REFERENCES match_rule (id),
    candidate  text NOT NULL REFERENCES candidate (id),

    CONSTRAINT match_rule_clearing_citizenship_pkey PRIMARY KEY (match_rule, candidate)
);

COMMENT ON TABLE match_rule_clearing_citizenship IS
    'A household holding this citizenship clears this gate wherever the gate asks: it matches with no recorded answer (reqs.md 3.7, 7.3, Q239).';

INSERT INTO match_rule_clearing_citizenship (match_rule, candidate)
SELECT match_rule, citizenship FROM clearing_seed;

-- 2. The gate the household's citizenships decide outright.
ALTER TABLE match_rule
    ADD COLUMN decided_by_citizenship boolean NOT NULL DEFAULT false;

ALTER TABLE match_rule
    ADD CONSTRAINT match_rule_decided_by_citizenship_is_never_researched
    CHECK (NOT (decided_by_citizenship AND researchable));

COMMENT ON COLUMN match_rule.decided_by_citizenship IS
    'Whether the household''s citizenships decide this gate with no recorded answer: cleared by one of them, or not matching where none clears it (reqs.md 7.3 "Definitional").';

UPDATE match_rule
SET    decided_by_citizenship = true,
       description = 'The candidate is an EU or EEA state, and the household holds an EU, EEA or Swiss citizenship, which carries free movement there.'
WHERE  id = 'eu_free_movement';

-- 3. EU free movement is a question about the EU and EEA states.
INSERT INTO match_rule_candidate (match_rule, candidate, level)
SELECT 'eu_free_movement', area.candidate, 'country'
FROM   free_movement_area AS area
ON CONFLICT ON CONSTRAINT match_rule_candidate_pkey DO NOTHING;

-- 4. The citizenships each answer assumed.
CREATE TABLE match_rule_answer_citizenship (
    answer      bigint NOT NULL REFERENCES match_rule_answer (id),
    citizenship text   NOT NULL REFERENCES candidate (id),

    CONSTRAINT match_rule_answer_citizenship_pkey PRIMARY KEY (answer, citizenship)
);

-- Every version already stored recorded none; every version written from now on does.
ALTER TABLE match_rule_answer
    ADD COLUMN citizenships_recorded boolean NOT NULL DEFAULT false;
ALTER TABLE match_rule_answer
    ALTER COLUMN citizenships_recorded SET DEFAULT true;

COMMENT ON COLUMN match_rule_answer.citizenships_recorded IS
    'Whether the citizenships this version assumed were recorded. False only on a version written before 0517: its assumption is unknown, so it is flagged for a re-check while the household holds any citizenship (Q239).';

-- 6. The live answer a re-check's proposal stands beside, of its own pair.
ALTER TABLE match_rule_answer
    ADD COLUMN beside_answer bigint;
ALTER TABLE match_rule_answer
    ADD CONSTRAINT match_rule_answer_stands_beside_an_answer_of_its_pair
    FOREIGN KEY (beside_answer, match_rule, candidate)
    REFERENCES match_rule_answer (id, match_rule, candidate);

UPDATE match_rule_answer AS proposal
SET    beside_answer = r.answer
FROM   match_rule_result AS r
JOIN   match_rule_answer AS live ON live.id = r.answer
JOIN   data_source AS person ON person.id = r.data_source AND person.source_kind <> 'llm'
WHERE  proposal.match_rule = r.match_rule
  AND  proposal.candidate = r.candidate
  AND  (proposal.recorded_at, proposal.id) > (live.recorded_at, live.id)
  AND  EXISTS (SELECT 1 FROM data_source AS model
               WHERE model.id = proposal.data_source AND model.source_kind = 'llm');

COMMENT ON COLUMN match_rule_answer.beside_answer IS
    'The live answer a re-check''s proposal was stored beside (D53). Pending while that answer is still live. Null on every other version.';

COMMENT ON TABLE match_rule_answer_citizenship IS
    'The household citizenships an answer version assumed, copied when it was written and never changed. An answer whose assumption differs from the household''s citizenships now needs a re-check (Q239).';

-- 5. A saved ranking's refusals and warnings decided by citizenship.
CREATE TABLE evaluation_citizenship (
    evaluation bigint NOT NULL REFERENCES evaluation (id) ON DELETE CASCADE,
    candidate  text   NOT NULL REFERENCES candidate (id),

    CONSTRAINT evaluation_citizenship_pkey PRIMARY KEY (evaluation, candidate)
);

COMMENT ON TABLE evaluation_citizenship IS
    'The household citizenships a saved ranking''s gates were decided by citizenship on, frozen with it (Q239).';

ALTER TABLE non_match_reason
    ADD COLUMN decided_by_citizenship boolean NOT NULL DEFAULT false;
ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_decided_by_citizenship_reads_no_answer
    CHECK (NOT decided_by_citizenship
           OR (match_rule IS NOT NULL AND match_rule_answer IS NULL));

ALTER TABLE candidate_gate_warning
    ADD COLUMN decided_by_citizenship boolean NOT NULL DEFAULT false;
ALTER TABLE candidate_gate_warning
    ALTER COLUMN match_rule_answer DROP NOT NULL;
ALTER TABLE candidate_gate_warning
    ADD CONSTRAINT candidate_gate_warning_reads_an_answer_or_the_citizenships
    CHECK ((match_rule_answer IS NULL) = decided_by_citizenship);

DO $$
DECLARE
    cleared integer;
    concerned integer;
BEGIN
    SELECT count(*) INTO cleared FROM match_rule_clearing_citizenship;
    SELECT count(*) INTO concerned
    FROM   match_rule_candidate WHERE match_rule = 'eu_free_movement';
    IF cleared <> 35 OR concerned <> 30 THEN
        RAISE EXCEPTION
            'expected 35 clearing citizenships and 30 free-movement states, found % and %',
            cleared, concerned;
    END IF;
END $$;
