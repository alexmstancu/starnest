-- The ISO 3166-1 alpha-2 code of a country, as a property of the country.
--
-- Our identifiers are readable names (arch.md 3.2) and every structured source keys countries
-- by code: Eurostat and the World Bank on AT and BE, others on alpha-3 or on a numeric id.
-- Something has to hold that translation, and where it is held decides whether the next
-- adapter repeats the work of this one.
--
-- It is held here because alpha-2 is a fact about the place rather than about any source. A
-- lookup table inside the Eurostat adapter would answer the same question, once, for one
-- adapter, and would have to be written again for the World Bank and again for the OECD -- and
-- the second copy is the one that goes out of step. What genuinely belongs to an adapter is a
-- source's DEVIATIONS from the standard: Eurostat writes Greece EL and the United Kingdom UK,
-- neither of which is ISO, and both of which are facts about Eurostat.
--
-- Nullable, and null for a city. A city's country is reached through parent_candidate, and
-- copying the country's code onto each of its cities would collide with the uniqueness below
-- while adding nothing that the hierarchy does not already say. The column is not restricted
-- to the country level by a CHECK, because that would write the identifier of one level into
-- the schema, and levels are ordered records rather than a hardcoded pair (reqs.md 3.1).
-- depends: 0014-whole-gate-periods

ALTER TABLE candidate ADD COLUMN country_code text;

-- Two uppercase letters, which is the whole of the ISO 3166-1 alpha-2 grammar. It rules out
-- the mistake worth ruling out: an alpha-3 code, or a source's own spelling, stored in a
-- column whose readers will treat it as the standard.
ALTER TABLE candidate
    ADD CONSTRAINT candidate_country_code_is_iso_3166_alpha_2
        CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- One country per code. NULLs are distinct by default in PostgreSQL, so every city keeps its
-- empty column without competing for one.
ALTER TABLE candidate
    ADD CONSTRAINT candidate_country_code_unique UNIQUE (country_code);

COMMENT ON COLUMN candidate.country_code IS
    'ISO 3166-1 alpha-2. A fact about the country, read by every adapter that keys on codes. Null for a city, whose country is reached through parent_candidate.';
