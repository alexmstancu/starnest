-- `li_eea_quota`: the Liechtenstein residence quota, declared as a gate and enforced by nobody.
--
-- The 2026-10-03 pension-portability research (reqs.md 6.9) found the only informative spread in
-- `country.pension_portability` was two outliers -- the UK and Switzerland -- and that both are
-- gate-shaped rather than score-shaped: a 60 on a 15%-weighted criterion says "somewhat harder",
-- while a gate says "not without a permit draw", which is what is true. The catalog already held
-- `uk_skilled_worker` and `ch_eu_efta_quota` for the first two. Liechtenstein is the third case
-- the research named -- the EEA Agreement's sectoral adaptation grants it a minimum of 56 new
-- residence permits a year, split between an employment and a self-sufficient lottery -- and it
-- was "the one row missing".
--
-- **Declared, not enforced, not answered.** This is a fact about the world: the quota exists. Who
-- it disqualifies is a preference that lives in a criteria set (reqs.md 3.7), and the shipped sets
-- enforce no gate, so adding this row re-ranks nothing. Whether to enforce it, and the per-candidate
-- answer, are the household's -- entered manually or proposed by the LLM and confirmed by a person
-- (reqs.md 6.9, Q218). An undecided rule never fires, which is the designed state for a row that is
-- declared but turned on by no set.
--
-- **No citation here, by design.** `match_rule` holds only the rule; the pages behind a decision
-- live in `match_rule_result_citation`, which hangs off an answer per candidate. There is no answer
-- yet, so there is no page to store -- the EUR-Lex review the research cites attaches to the result
-- a person records, not to this declaration.
-- depends: 0492-child-benefit-is-a-share-of-the-wage

INSERT INTO match_rule (id, level, name) VALUES
    ('li_eea_quota', 'country', 'Liechtenstein EEA residence quota')
ON CONFLICT (id) DO UPDATE SET
    level = EXCLUDED.level,
    name  = EXCLUDED.name;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM match_rule WHERE id = 'li_eea_quota' AND level = 'country'
    ) THEN
        RAISE EXCEPTION 'li_eea_quota was not declared as a country-level gate';
    END IF;
END $$;
