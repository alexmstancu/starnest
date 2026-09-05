-- Catalog: the ISO 3166-1 alpha-2 code of each of the 32 seeded countries.
--
-- 0015 added the column and deliberately left it empty: a schema migration says what a column
-- is, and which code belongs to which country is catalog data like every other row here
-- (arch.md 1.2). This is that data.
--
-- The codes are ISO's, not any source's. Greece is GR and the United Kingdom is GB, which is
-- what the standard says; Eurostat writes EL and UK for the same two places, and that
-- substitution is a fact about Eurostat and lives in the Eurostat adapter. Writing Eurostat's
-- spelling here would make the column a Eurostat column, and the second adapter would then
-- have to know which source the "standard" code was standard for.
--
-- Nothing is invented: alpha-2 is published, permanent and unambiguous, so this is one of the
-- few tables where the correct value is not a judgement.
-- depends: 0114-a-nested-candidate-has-a-parent 0015-candidate-country-code

UPDATE candidate SET country_code = codes.code
FROM (VALUES
    ('country.austria',        'AT'),
    ('country.belgium',        'BE'),
    ('country.bulgaria',       'BG'),
    ('country.croatia',        'HR'),
    ('country.cyprus',         'CY'),
    ('country.czechia',        'CZ'),
    ('country.denmark',        'DK'),
    ('country.estonia',        'EE'),
    ('country.finland',        'FI'),
    ('country.france',         'FR'),
    ('country.germany',        'DE'),
    ('country.greece',         'GR'),
    ('country.hungary',        'HU'),
    ('country.ireland',        'IE'),
    ('country.italy',          'IT'),
    ('country.latvia',         'LV'),
    ('country.lithuania',      'LT'),
    ('country.luxembourg',     'LU'),
    ('country.malta',          'MT'),
    ('country.netherlands',    'NL'),
    ('country.poland',         'PL'),
    ('country.portugal',       'PT'),
    ('country.romania',        'RO'),
    ('country.slovakia',       'SK'),
    ('country.slovenia',       'SI'),
    ('country.spain',          'ES'),
    ('country.sweden',         'SE'),
    ('country.iceland',        'IS'),
    ('country.norway',         'NO'),
    ('country.liechtenstein',  'LI'),
    ('country.united_kingdom', 'GB'),
    ('country.switzerland',    'CH')
) AS codes (candidate, code)
WHERE candidate.id = codes.candidate;
