-- Catalog: the 32 seeded countries of reqs.md 6.1 -- EU 27, plus Iceland, Norway and
-- Liechtenstein, plus the United Kingdom and Switzerland.
--
-- The list is broad on purpose. Pruning it is the not_manually_excluded match rule and a
-- property of a criteria set, never a deletion here: a ruled-out country keeps its score and
-- stays visible with the reason (reqs.md 6.1, 5.4).
--
-- parent_candidate and parent_level stay NULL: a country nests under nothing.
-- depends: 0101-catalog-pillars-and-attributes

INSERT INTO candidate (id, name, level) VALUES
    ('country.austria', 'Austria', 'country'),
    ('country.belgium', 'Belgium', 'country'),
    ('country.bulgaria', 'Bulgaria', 'country'),
    ('country.croatia', 'Croatia', 'country'),
    ('country.cyprus', 'Cyprus', 'country'),
    ('country.czechia', 'Czechia', 'country'),
    ('country.denmark', 'Denmark', 'country'),
    ('country.estonia', 'Estonia', 'country'),
    ('country.finland', 'Finland', 'country'),
    ('country.france', 'France', 'country'),
    ('country.germany', 'Germany', 'country'),
    ('country.greece', 'Greece', 'country'),
    ('country.hungary', 'Hungary', 'country'),
    ('country.ireland', 'Ireland', 'country'),
    ('country.italy', 'Italy', 'country'),
    ('country.latvia', 'Latvia', 'country'),
    ('country.lithuania', 'Lithuania', 'country'),
    ('country.luxembourg', 'Luxembourg', 'country'),
    ('country.malta', 'Malta', 'country'),
    ('country.netherlands', 'Netherlands', 'country'),
    ('country.poland', 'Poland', 'country'),
    ('country.portugal', 'Portugal', 'country'),
    ('country.romania', 'Romania', 'country'),
    ('country.slovakia', 'Slovakia', 'country'),
    ('country.slovenia', 'Slovenia', 'country'),
    ('country.spain', 'Spain', 'country'),
    ('country.sweden', 'Sweden', 'country'),
    ('country.iceland', 'Iceland', 'country'),
    ('country.norway', 'Norway', 'country'),
    ('country.liechtenstein', 'Liechtenstein', 'country'),
    ('country.united_kingdom', 'United Kingdom', 'country'),
    ('country.switzerland', 'Switzerland', 'country')
ON CONFLICT (id) DO UPDATE SET
    name  = EXCLUDED.name,
    level = EXCLUDED.level;
