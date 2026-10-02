-- Back to a shared 16 and no uniqueness.
UPDATE data_source SET default_priority = 16 WHERE id = 'unodc';
UPDATE data_source SET default_priority = 17 WHERE id = 'ilo';
UPDATE data_source SET default_priority = 18 WHERE id = 'fao';
UPDATE data_source SET default_priority = 19 WHERE id = 'unesco';
UPDATE data_source SET default_priority = 20 WHERE id = 'open_meteo';
UPDATE data_source SET default_priority = 21 WHERE id = 'copernicus';
UPDATE data_source SET default_priority = 22 WHERE id = 'protected_planet';
UPDATE data_source SET default_priority = 23 WHERE id = 'natural_earth';
UPDATE data_source SET default_priority = 24 WHERE id = 'koeppen';
UPDATE data_source SET default_priority = 25 WHERE id = 'eurobarometer';
