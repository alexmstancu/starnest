-- Give the codes back. The column stays; 0015 owns it.
--
-- Only the countries seeded by 0102 are cleared, so a code recorded against a candidate this
-- migration never touched survives a rollback of this migration.

UPDATE candidate SET country_code = NULL
WHERE  id IN (
    'country.austria', 'country.belgium', 'country.bulgaria', 'country.croatia',
    'country.cyprus', 'country.czechia', 'country.denmark', 'country.estonia',
    'country.finland', 'country.france', 'country.germany', 'country.greece',
    'country.hungary', 'country.ireland', 'country.italy', 'country.latvia',
    'country.lithuania', 'country.luxembourg', 'country.malta', 'country.netherlands',
    'country.poland', 'country.portugal', 'country.romania', 'country.slovakia',
    'country.slovenia', 'country.spain', 'country.sweden', 'country.iceland',
    'country.norway', 'country.liechtenstein', 'country.united_kingdom',
    'country.switzerland'
);
