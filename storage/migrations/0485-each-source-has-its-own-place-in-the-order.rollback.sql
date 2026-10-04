-- Back to a shared 16 and no uniqueness.
--
-- **`copernicus` sits above `open_meteo`, which is the order the catalog actually had.** `0449`
-- and before leave `copernicus` on 20 and `open_meteo` on 21; restoring them the other way
-- round reversed a preference between two publishers that nothing here was asked to change,
-- and it did it quietly, because both numbers stayed inside the block and the count of rows
-- never moved. The forward migration's own header says "the relative order is unchanged" --
-- that claim is true of this file now.
UPDATE data_source SET default_priority = 16 WHERE id = 'unodc';
UPDATE data_source SET default_priority = 17 WHERE id = 'ilo';
UPDATE data_source SET default_priority = 18 WHERE id = 'fao';
UPDATE data_source SET default_priority = 19 WHERE id = 'unesco';
UPDATE data_source SET default_priority = 20 WHERE id = 'copernicus';
UPDATE data_source SET default_priority = 21 WHERE id = 'open_meteo';
UPDATE data_source SET default_priority = 22 WHERE id = 'protected_planet';
UPDATE data_source SET default_priority = 23 WHERE id = 'natural_earth';
UPDATE data_source SET default_priority = 24 WHERE id = 'koeppen';
UPDATE data_source SET default_priority = 25 WHERE id = 'eurobarometer';
