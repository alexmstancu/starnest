-- Catalog: the reference vocabularies the rest of the catalog points at.
--
-- Every row here is data, not code (arch.md 1.2), and every statement upserts by identifier so
-- re-running a partially applied sequence is safe (arch.md 7.4).
-- depends: 0012-indexes

-- The two levels of reqs.md 3.1. Ordered records, not a hardcoded pair: a third would be
-- another row, and nothing in the schema counts them.
INSERT INTO level (id, depth_order, parent_level) VALUES
    ('country', 1, NULL),
    ('city', 2, 'country')
ON CONFLICT (id) DO UPDATE SET
    depth_order  = EXCLUDED.depth_order,
    parent_level = EXCLUDED.parent_level;

-- The dimensions the country-level Quantity attributes measure in.
INSERT INTO unit (id, name) VALUES
    ('percent_per_year', 'Percent per year'),
    ('hours_per_week', 'Hours per week'),
    ('hours_per_year', 'Hours per year'),
    ('days_per_year', 'Days per year'),
    ('celsius', 'Degrees Celsius'),
    ('km_per_1000_km2', 'Kilometres per 1,000 square kilometres'),
    ('metre', 'Metres'),
    ('ladder_points', 'Cantril ladder points'),
    ('years', 'Years'),
    ('weeks', 'Weeks')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- EUR, GBP and CHF are named in arch.md 3.2a; the rest are the national currencies of the 32
-- seeded countries, so a monetary value can be stored exactly as issued (reqs.md 5.5).
INSERT INTO currency (id, name) VALUES
    ('EUR', 'Euro'),
    ('GBP', 'Pound sterling'),
    ('CHF', 'Swiss franc'),
    ('BGN', 'Bulgarian lev'),
    ('CZK', 'Czech koruna'),
    ('DKK', 'Danish krone'),
    ('HUF', 'Hungarian forint'),
    ('PLN', 'Polish zloty'),
    ('RON', 'Romanian leu'),
    ('SEK', 'Swedish krona'),
    ('ISK', 'Icelandic krona'),
    ('NOK', 'Norwegian krone')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Every source named in the Sources column of reqs.md 7.1.
--
-- default_priority follows the five families of reqs.md 6.6, highest priority first: official
-- international statistics, national authorities, crowdsourced datasets, the LLM, manual entry.
-- Gaps between the bands are deliberate -- a new adapter slots in without renumbering.
--
-- Two families the catalog needs and 6.6 does not name: `research_index` for published indices
-- that are neither official statistics nor crowdsourced (MIPEX, EF EPI, RSF, Transparency
-- International, V-Dem), ranked below national authorities and above crowdsourced; and
-- `derived`, for a figure this application computes from attributes it already fetched.
--
-- reliability_tier names the family rather than the access tier of datasources.md 4. Access
-- cost says nothing about what a number is worth, and reliability_tier is what per-value
-- confidence is derived from (reqs.md 5.7).
INSERT INTO data_source (id, name, source_kind, default_priority, reliability_tier) VALUES
    ('eurostat', 'Eurostat', 'structured', 10, 'official_international'),
    ('oecd', 'OECD', 'structured', 11, 'official_international'),
    ('world_bank', 'World Bank', 'structured', 12, 'official_international'),
    ('imf', 'IMF', 'structured', 13, 'official_international'),
    ('european_commission', 'European Commission', 'structured', 14, 'official_international'),
    ('who', 'WHO Global Health Observatory', 'structured', 15, 'official_international'),
    ('unodc', 'UNODC', 'structured', 16, 'official_international'),
    ('ilo', 'ILO', 'structured', 17, 'official_international'),
    ('fao', 'FAO', 'structured', 18, 'official_international'),
    ('unesco', 'UNESCO', 'structured', 19, 'official_international'),
    ('copernicus', 'Copernicus', 'structured', 20, 'official_international'),
    ('open_meteo', 'Open-Meteo', 'structured', 21, 'official_international'),
    ('protected_planet', 'Protected Planet (WDPA)', 'structured', 22, 'official_international'),
    ('natural_earth', 'Natural Earth', 'structured', 23, 'official_international'),
    ('koeppen', 'Koeppen-Geiger classification', 'structured', 24, 'official_international'),
    ('eurobarometer', 'Eurobarometer', 'structured', 25, 'official_international'),
    ('national_statistics', 'National statistics offices', 'structured', 40, 'national_authority'),
    ('national_tax_authority', 'National tax authorities', 'structured', 41, 'national_authority'),
    ('national_regulator', 'National regulators', 'structured', 42, 'national_authority'),
    ('national_law', 'Official administrative and legal sources', 'manual', 43, 'national_authority'),
    ('national_social_security', 'National social-security bodies', 'structured', 44, 'national_authority'),
    ('airport_authority', 'Airport authorities', 'structured', 45, 'national_authority'),
    ('mipex', 'MIPEX', 'structured', 50, 'research_index'),
    ('ef_epi', 'EF English Proficiency Index', 'manual', 51, 'research_index'),
    ('rsf', 'Reporters Without Borders', 'structured', 52, 'research_index'),
    ('transparency_international', 'Transparency International', 'structured', 53, 'research_index'),
    ('v_dem', 'V-Dem', 'structured', 54, 'research_index'),
    ('numbeo', 'Numbeo', 'structured', 60, 'crowdsourced'),
    ('openflights', 'OpenFlights', 'structured', 61, 'crowdsourced'),
    ('internations', 'InterNations', 'manual', 62, 'crowdsourced'),
    ('company_website', 'Company websites', 'manual', 63, 'crowdsourced'),
    ('derived', 'Derived from other attributes', 'structured', 70, 'derived'),
    ('llm', 'LLM with web search', 'llm', 80, 'llm'),
    ('manual', 'Manual entry', 'manual', 90, 'manual')
ON CONFLICT (id) DO UPDATE SET
    name             = EXCLUDED.name,
    source_kind      = EXCLUDED.source_kind,
    default_priority = EXCLUDED.default_priority,
    reliability_tier = EXCLUDED.reliability_tier;
