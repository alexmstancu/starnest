-- Every gate says what it tests, in words: when a candidate matches it (PL-155, UF-039, D57).
--
-- depends: 0514-a-gate-concerns-only-candidates-at-its-level
--
-- A gate's row in Configure said only "Asked at country level.", so nothing on screen said what
-- the UK Skilled Worker gate or the Swiss quota actually asks. What a gate tests is a fact about
-- the gate, written once, so it is **catalog data** rather than text in the interface (arch.md
-- 1.2): `match_rule.description`, seeded from reqs.md 7.3's "Matches when" column, with the
-- document's own cross-references taken out because a reader on screen cannot follow them.
-- `eu_free_movement`'s "Automatic while that citizenship is EU" is left out too: nothing derives
-- that gate yet (reqs.md 7.3, the gates map's S6), and a description must not promise it.
--
-- **Every gate must carry one**, so a gate declared later cannot reach the screen with nothing
-- to say: NOT NULL and non-blank. **It refuses before changing anything** when the catalog holds
-- a gate this migration has no description for, naming every one at once.

-- **Locked first** (BE-A1): a gate declared between the check and the NOT NULL would break it.
LOCK TABLE match_rule IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE gate_description (
    match_rule  text NOT NULL,
    description text NOT NULL
);

INSERT INTO gate_description (match_rule, description) VALUES
    ('eu_free_movement',
     'The candidate is an EU or EEA state, and the household''s citizenship carries free movement there.'),
    ('uk_skilled_worker',
     'A realistic Skilled Worker route exists: sponsorship available in the local market, or the salary threshold met.'),
    ('ch_eu_efta_quota',
     'The annual Swiss EU/EFTA permit quota has capacity for this household.'),
    ('li_eea_quota',
     'The annual Liechtenstein EEA residence-permit quota (a minimum of 56 a year under the EEA Agreement''s sectoral adaptation) has capacity for this household.'),
    ('not_manually_excluded',
     'You have not ruled this candidate out by hand.');

DO $$
DECLARE
    undescribed text;
BEGIN
    SELECT string_agg(r.id, ', ' ORDER BY r.id) INTO undescribed
    FROM   match_rule AS r
    WHERE  NOT EXISTS (SELECT 1 FROM gate_description AS d WHERE d.match_rule = r.id);

    IF undescribed IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: every gate must say what it tests, and there is no description for %',
            undescribed;
    END IF;
END $$;

ALTER TABLE match_rule
    ADD COLUMN description text;

UPDATE match_rule AS r
SET    description = d.description
FROM   gate_description AS d
WHERE  d.match_rule = r.id;

ALTER TABLE match_rule
    ALTER COLUMN description SET NOT NULL;

ALTER TABLE match_rule
    ADD CONSTRAINT match_rule_says_what_it_tests CHECK (btrim(description) <> '');

COMMENT ON COLUMN match_rule.description IS
    'When a candidate matches this gate, in words a reader can act on (reqs.md 7.3, "Matches when"). Shown on screen; never an identifier.';

DROP TABLE gate_description;
