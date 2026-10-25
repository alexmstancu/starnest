-- A citizenship clears the gates it names, and EU free movement is derived from one (PL-164,
-- UF-029, G-S6, D59).
--
-- depends: 0520-a-criterion-carries-one-bound-at-most
--
-- The household's citizenships reached no gate. A British passport did not clear the UK Skilled
-- Worker route, and nothing derived `eu_free_movement`, so that enforced gate never fired for
-- anybody (reqs.md 7.3: "Automatic while that citizenship is EU"). Which citizenship clears which
-- gate is a fact about the law, so it is **catalog data, never code** (arch.md 1.2):
--
-- 1. `match_rule_clearing_citizenship`: a household holding one of these clears the gate wherever
--    the gate asks. Seeded only where a source says so:
--      - `eu_free_movement` <- each of the 27 EU member states: reqs.md 7.3, "Automatic while that
--        citizenship is EU". reqs.md is silent on EEA-only (Iceland, Liechtenstein, Norway) and
--        Swiss citizenships, so none is seeded: a household holding only one of those is told the
--        gate does not clear, and a person decides.
--      - `uk_skilled_worker` <- the United Kingdom and Ireland: the design's README, "Citizenship
--        drives the citizenship gates", and DECISIONS R5 ("hold a British or Irish passport and the
--        UK skilled-worker gate stops applying"). reqs.md 7.3 is silent.
--      - `ch_eu_efta_quota` <- Switzerland: the same two design sources. reqs.md 7.3 is silent.
--      - `li_eea_quota`, `not_manually_excluded`, `two_role_feasibility`: nothing. Neither
--        reqs.md nor the design names a citizenship for them.
-- 2. `match_rule.decided_by_citizenship`: a gate the household's citizenships decide outright --
--    reqs.md 7.3's "Definitional" source, `eu_free_movement` alone. Where none of the household's
--    citizenships clears it, it does not match, with no recorded answer. Never researchable.
-- 3. `eu_free_movement` concerns the 30 EU and EEA states (reqs.md 7.3, "The candidate is an EU
--    or EEA state"), so it is never derived for the United Kingdom or Switzerland, whose own gates
--    ask about them.
-- 4. `match_rule_answer_citizenship`: the citizenships each answer assumed, copied from the
--    household when the version is written. An answer is flagged for a re-check on read when the
--    household's citizenships differ -- never expired and never overwritten (household policy
--    2026-10-13). A version written before this assumed nothing on record and is not flagged.
-- 5. A saved ranking keeps a refusal or warning decided by citizenship, which reads no recorded
--    answer: `decided_by_citizenship` on `non_match_reason` and `candidate_gate_warning`, and the
--    citizenships it was decided on in `evaluation_citizenship`.
--
-- **It refuses before changing anything** when a gate or country it names is missing, naming
-- every one at once.

-- **Locked first** (BE-A1): the seed reads the catalog, and the new constraints read rows a
-- concurrent writer could add between the check and the change.
LOCK TABLE match_rule, match_rule_candidate, candidate, non_match_reason, candidate_gate_warning
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

INSERT INTO clearing_seed (match_rule, citizenship) VALUES
    ('uk_skilled_worker', 'country.united_kingdom'),
    ('uk_skilled_worker', 'country.ireland'),
    ('ch_eu_efta_quota',  'country.switzerland');

CREATE TEMP TABLE free_movement_area (candidate text NOT NULL);

INSERT INTO free_movement_area (candidate)
SELECT citizenship FROM clearing_seed WHERE match_rule = 'eu_free_movement'
UNION ALL
SELECT unnest(ARRAY['country.iceland', 'country.liechtenstein', 'country.norway']);

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

UPDATE match_rule SET decided_by_citizenship = true WHERE id = 'eu_free_movement';

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
    IF cleared <> 30 OR concerned <> 30 THEN
        RAISE EXCEPTION
            'expected 30 clearing citizenships and 30 free-movement states, found % and %',
            cleared, concerned;
    END IF;
END $$;
