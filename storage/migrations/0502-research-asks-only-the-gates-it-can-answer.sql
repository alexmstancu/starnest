-- Research asks only the gates it can answer, about only the candidates they concern (NEW-01).
--
-- depends: 0501-a-run-records-the-figures-it-re-confirmed
--
-- Gate research asked every gate about every candidate at the level: five country gates over
-- thirty-two countries, 160 paid calls. reqs.md 7.3 names three of the five "Manual,
-- LLM-assisted", and each of those three is a question about one country -- the UK Skilled Worker
-- route about the United Kingdom, the Swiss and Liechtenstein quotas about Switzerland and
-- Liechtenstein. `eu_free_movement` is definitional, read from the household's citizenship, and
-- `not_manually_excluded` is the household's own judgement: a model asked about either is billed
-- for an answer nobody can use. A pass over the level now asks three questions.
--
-- **Both facts are catalog rows, not code** (arch.md 1.2). Whether a model may research a gate is
-- `match_rule.researchable`; which candidates a gate concerns is `match_rule_candidate`, and **no
-- rows for a gate means every candidate at its level**. So the two gates that concern everybody,
-- and any gate declared without a thought for research, keep meaning exactly what they meant, and
-- a researchable gate stays off until a migration says it may be asked.
--
-- **It refuses before changing anything** when a gate or a country it names is missing: it names
-- rows earlier migrations seeded, and marking two gates of three would quietly leave the third to
-- be researched about nobody. The refusal names every missing id at once.

CREATE TEMP TABLE researched_gate (
    match_rule text NOT NULL,
    candidate  text NOT NULL
);

INSERT INTO researched_gate (match_rule, candidate) VALUES
    ('uk_skilled_worker', 'country.united_kingdom'),
    ('ch_eu_efta_quota',  'country.switzerland'),
    ('li_eea_quota',      'country.liechtenstein');

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(absent.named, ', ' ORDER BY absent.named) INTO missing
    FROM (
        SELECT 'gate ' || g.match_rule AS named
        FROM   researched_gate AS g
        WHERE  NOT EXISTS (SELECT 1 FROM match_rule AS r WHERE r.id = g.match_rule)
        UNION ALL
        SELECT 'candidate ' || g.candidate
        FROM   researched_gate AS g
        WHERE  NOT EXISTS (SELECT 1 FROM candidate AS c WHERE c.id = g.candidate)
    ) AS absent;

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: this names %, which the catalog does not have', missing;
    END IF;
END $$;

ALTER TABLE match_rule
    ADD COLUMN researchable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN match_rule.researchable IS
    'Whether a model may be asked to research this gate (reqs.md 6.10 use 3, 7.3). Only a gate decided by reading official pages is.';

CREATE TABLE match_rule_candidate (
    match_rule text NOT NULL REFERENCES match_rule (id),
    candidate  text NOT NULL REFERENCES candidate (id),

    CONSTRAINT match_rule_candidate_pkey PRIMARY KEY (match_rule, candidate)
);

COMMENT ON TABLE match_rule_candidate IS
    'The candidates a gate is a question about. No rows for a gate means every candidate at its level (reqs.md 7.3).';

UPDATE match_rule
SET    researchable = true
WHERE  id IN (SELECT g.match_rule FROM researched_gate AS g);

INSERT INTO match_rule_candidate (match_rule, candidate)
SELECT g.match_rule, g.candidate
FROM   researched_gate AS g
ON CONFLICT ON CONSTRAINT match_rule_candidate_pkey DO NOTHING;

DO $$
DECLARE
    researchable_gates integer;
    concerned_pairs    integer;
BEGIN
    SELECT count(*) INTO researchable_gates
    FROM   match_rule AS r
    JOIN   researched_gate AS g ON g.match_rule = r.id
    WHERE  r.researchable;

    SELECT count(*) INTO concerned_pairs
    FROM   match_rule_candidate AS c
    JOIN   researched_gate AS g ON g.match_rule = c.match_rule AND g.candidate = c.candidate;

    IF researchable_gates <> 3 OR concerned_pairs <> 3 THEN
        RAISE EXCEPTION
            'expected 3 researchable gates each concerning its country, found % gate(s) and % pair(s)',
            researchable_gates, concerned_pairs;
    END IF;
END $$;

DROP TABLE researched_gate;
