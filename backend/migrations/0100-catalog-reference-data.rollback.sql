-- Remove the seeded reference vocabularies.
--
-- These are plain deletes, never cascades: a foreign key from a stored value is exactly what
-- should make this fail rather than quietly discard data (arch.md 7.4).

DELETE FROM data_source WHERE id IN ('eurostat', 'oecd', 'world_bank', 'imf', 'european_commission', 'who', 'unodc', 'ilo', 'fao', 'unesco', 'copernicus', 'open_meteo', 'protected_planet', 'natural_earth', 'koeppen', 'eurobarometer', 'national_statistics', 'national_tax_authority', 'national_regulator', 'national_law', 'national_social_security', 'airport_authority', 'mipex', 'ef_epi', 'rsf', 'transparency_international', 'v_dem', 'numbeo', 'openflights', 'internations', 'company_website', 'derived', 'llm', 'manual');
DELETE FROM currency    WHERE id IN ('EUR', 'GBP', 'CHF', 'BGN', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK', 'ISK', 'NOK');
DELETE FROM unit        WHERE id IN ('percent_per_year', 'hours_per_week', 'hours_per_year', 'days_per_year', 'celsius', 'km_per_1000_km2', 'metre', 'ladder_points', 'years', 'weeks');
DELETE FROM level       WHERE id IN ('country', 'city');
