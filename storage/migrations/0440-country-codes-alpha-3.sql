-- Catalog: the ISO 3166-1 alpha-3 code of each of the 32 seeded countries.
--
-- **Why the catalog and not the adapter.** `0120` set the rule: this table holds ISO's codes,
-- and a source's own spelling is a fact about that source and lives in its adapter -- which is
-- why Eurostat's EL for Greece and UK for the kingdom are in `data_sources/eurostat/geography`
-- rather than here. Alpha-3 is not a dialect. It is the same standard's other form, published
-- and unambiguous, and WHO, FAO, UNODC and Protected Planet all speak it. Putting it in one
-- adapter would mean writing it again in the next three.
--
-- The column and its data arrive together, unlike alpha-2, which `0015` declared and `0120`
-- filled months later. There was nothing to decide here: splitting them would produce one
-- migration that does nothing useful and another that cannot run without it.
--
-- Nothing is invented. The pairs are read off the World Bank's own response, which returns both
-- forms for every country -- `country.id` and `countryiso3code` -- so this is a transcription
-- of a published mapping rather than a judgement.
-- depends: 0411-career-and-connectivity-join-the-minimal-set

ALTER TABLE candidate ADD COLUMN country_code_alpha3 text;

ALTER TABLE candidate ADD CONSTRAINT candidate_country_code_alpha3_unique
    UNIQUE (country_code_alpha3);

ALTER TABLE candidate ADD CONSTRAINT candidate_country_code_alpha3_is_three_letters
    CHECK (country_code_alpha3 IS NULL OR country_code_alpha3 ~ '^[A-Z]{3}$');

UPDATE candidate SET country_code_alpha3 = codes.alpha3
FROM (VALUES
    ('AT', 'AUT'), ('BE', 'BEL'), ('BG', 'BGR'), ('CH', 'CHE'), ('CY', 'CYP'), ('CZ', 'CZE'),
    ('DE', 'DEU'), ('DK', 'DNK'), ('EE', 'EST'), ('ES', 'ESP'), ('FI', 'FIN'), ('FR', 'FRA'),
    ('GB', 'GBR'), ('GR', 'GRC'), ('HR', 'HRV'), ('HU', 'HUN'), ('IE', 'IRL'), ('IS', 'ISL'),
    ('IT', 'ITA'), ('LI', 'LIE'), ('LT', 'LTU'), ('LU', 'LUX'), ('LV', 'LVA'), ('MT', 'MLT'),
    ('NL', 'NLD'), ('NO', 'NOR'), ('PL', 'POL'), ('PT', 'PRT'), ('RO', 'ROU'), ('SE', 'SWE'),
    ('SI', 'SVN'), ('SK', 'SVK')
) AS codes (alpha2, alpha3)
WHERE candidate.country_code = codes.alpha2;

-- **After the data, not before it.** Declared ahead of the UPDATE this refuses the very rows
-- the UPDATE is about to fix: every country already has an alpha-2 and, for one statement
-- longer, no alpha-3.
--
-- A candidate with one form and not the other is a candidate half the adapters can ask about,
-- which is the sort of gap that surfaces as unexplained missing data rather than as an error.
ALTER TABLE candidate ADD CONSTRAINT candidate_country_codes_arrive_together
    CHECK ((country_code IS NULL) = (country_code_alpha3 IS NULL));
