-- The two single-row tables: who is asking, and how the application is tuned.
--
-- Neither is seeded. Every number in both is marked provisional in reqs.md 3.9 and 3.10, and
-- inventing one here would be exactly the fabrication the product forbids. The household is
-- configured first, by the user, before anything else means much.
-- depends: 0007-gates-and-outside-opinions

CREATE TABLE household (
    id                    integer PRIMARY KEY,
    home_country_candidate text    NOT NULL REFERENCES candidate (id),
    home_city_candidate    text    REFERENCES candidate (id),
    -- Zero is allowed: someone may be living on savings. Negative is not a household.
    net_income             numeric NOT NULL CHECK (net_income >= 0),
    number_adults          integer NOT NULL,
    number_children        integer NOT NULL,
    -- Guideline ceilings. Provisional, therefore nullable and never defaulted.
    target_monthly_spend   numeric,
    max_rent               numeric,

    CONSTRAINT household_is_a_single_row     CHECK (id = 1),
    CONSTRAINT household_has_an_adult        CHECK (number_adults >= 1),
    CONSTRAINT household_children_not_negative CHECK (number_children >= 0),
    CONSTRAINT household_spend_not_negative  CHECK (target_monthly_spend IS NULL OR target_monthly_spend >= 0),
    CONSTRAINT household_rent_not_negative   CHECK (max_rent IS NULL OR max_rent >= 0)
);

COMMENT ON TABLE household IS
    'Configuration about you, not about any candidate. On the subjective side because it describes the asker (arch.md 3.6). The home country is a parameter, never a constant in code.';

CREATE TABLE household_citizenship (
    household integer NOT NULL REFERENCES household (id),
    candidate text    NOT NULL REFERENCES candidate (id),

    CONSTRAINT household_citizenship_pkey PRIMARY KEY (household, candidate)
);

COMMENT ON TABLE household_citizenship IS
    'Which citizenships the household holds. A list, therefore a table -- and it lets eu_free_movement be evaluated by a join rather than by parsing a string.';

CREATE TABLE settings (
    id                integer PRIMARY KEY,
    -- All four are provisional (reqs.md 3.10): nullable, unseeded, and set by the user.
    min_coverage      numeric,
    score_scale_max   integer,
    comparator_limit  integer,
    run_spend_cap_eur numeric,

    CONSTRAINT settings_is_a_single_row         CHECK (id = 1),
    -- A percentage, 0-100 (reqs.md Q185). Only the floor was checked before.
    CONSTRAINT settings_coverage_is_a_percentage
        CHECK (min_coverage IS NULL OR min_coverage BETWEEN 0 AND 100),
    CONSTRAINT settings_score_scale_is_positive CHECK (score_scale_max IS NULL OR score_scale_max > 0),
    CONSTRAINT settings_comparator_limit_is_positive
        CHECK (comparator_limit IS NULL OR comparator_limit >= 1),
    CONSTRAINT settings_spend_cap_not_negative  CHECK (run_spend_cap_eur IS NULL OR run_spend_cap_eur >= 0)
);

COMMENT ON TABLE settings IS
    'Typed columns rather than a key/value table: a setting_key/setting_value pair would make every one of them text, so nothing could check them (reqs.md 3.10).';
