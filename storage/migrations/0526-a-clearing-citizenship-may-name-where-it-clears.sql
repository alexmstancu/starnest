-- A clearing citizenship may name the candidates it clears a gate in, and a British one clears free
-- movement in Ireland (PL-164 review, Medium).
--
-- depends: 0517-citizenship-clears-the-gates-it-names
--
-- `match_rule_clearing_citizenship` (0517) was keyed (gate, citizenship): a citizenship cleared a
-- gate everywhere the gate asks, or nowhere. That cannot say what the Common Travel Area says.
-- British citizens may live and work in Ireland without permission under the Common Travel Area,
-- as the UK-Ireland Memorandum of Understanding on the CTA of 8 May 2019 restates -- but not in
-- any other EU or EEA state since the transition period ended on 31 December 2020. So
-- `eu_free_movement`, which concerns Ireland, ruled a British-only household out of Ireland --
-- and, being decided by citizenship, no recorded answer could clear it. 0517 already relies on the
-- CTA the other way, for Irish citizens clearing the UK route; this seeds the British direction.
--
-- **A row may now name one candidate it applies in** (`applies_in_candidate`). Null keeps 0517's
-- meaning: everywhere the gate asks. A named candidate must be one the gate concerns, held by a
-- foreign key into `match_rule_candidate`, so a scope can never point where the gate never asks.
-- **A citizenship clears a gate everywhere at most once**, and in each place at most once: two
-- partial unique indexes, in place of the old primary key.
--
-- No pre-check: the one row seeded names a gate, two countries and a concerned pair that 0517
-- seeded in the same chain, and the foreign keys refuse it by name if one is missing.

-- **Locked first** (BE-A1): the key is swapped and a row added, so a row written in between could
-- slip past both indexes.
LOCK TABLE match_rule_clearing_citizenship, match_rule_candidate IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE match_rule_clearing_citizenship
    ADD COLUMN applies_in_candidate text;

ALTER TABLE match_rule_clearing_citizenship
    ADD CONSTRAINT match_rule_clearing_citizenship_applies_where_the_gate_asks
    FOREIGN KEY (match_rule, applies_in_candidate)
    REFERENCES match_rule_candidate (match_rule, candidate);

ALTER TABLE match_rule_clearing_citizenship
    DROP CONSTRAINT match_rule_clearing_citizenship_pkey;

CREATE UNIQUE INDEX match_rule_clearing_citizenship_everywhere_once
    ON match_rule_clearing_citizenship (match_rule, candidate)
    WHERE applies_in_candidate IS NULL;

CREATE UNIQUE INDEX match_rule_clearing_citizenship_in_each_place_once
    ON match_rule_clearing_citizenship (match_rule, candidate, applies_in_candidate)
    WHERE applies_in_candidate IS NOT NULL;

COMMENT ON COLUMN match_rule_clearing_citizenship.applies_in_candidate IS
    'The one candidate this citizenship clears the gate in, which the gate must concern. Null: everywhere the gate asks (Q239).';

-- The Common Travel Area: a British citizen clears free movement in Ireland, and nowhere else.
INSERT INTO match_rule_clearing_citizenship (match_rule, candidate, applies_in_candidate)
VALUES ('eu_free_movement', 'country.united_kingdom', 'country.ireland');
