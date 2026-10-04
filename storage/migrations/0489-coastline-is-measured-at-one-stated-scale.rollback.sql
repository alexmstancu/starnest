-- Back to two sources that cannot answer the coastline, and a criterion that cannot place it.
UPDATE criterion SET normalisation_method = 'fixed'
WHERE  attribute = 'country.coastline_access';

DELETE FROM attribute_source_priority WHERE attribute = 'country.coastline_access';

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.coastline_access', 'natural_earth', 1),
       ('country.coastline_access', 'eurostat', 2);

-- **The figures go before the source they name.** `value_data_source_fkey` refuses to drop a
-- source 32 stored values point at, so deleting the row first fails outright -- as it did when
-- this was first attempted. The values are the thing this migration brought into existence, so
-- removing them is part of undoing it; every other figure in the database is untouched, and
-- the guard against deleting figures exempts a rollback for exactly this reason.
--
-- **A figure's own rows go before the figure**, which is the other direction and the one this
-- missed. Eleven tables reference `value` and none cascades, so deleting the figures alone
-- failed on `value_citation_value_fkey`: all 32 carry a citation naming the page they came
-- from, and a magnitude in `value_quantity`. A figure-free database deletes nothing here, so
-- the wall only appears once the migration has actually been run for real.
--
-- `candidate_attribute_score.used_value` is deliberately not cleared: a saved evaluation is a
-- frozen record that must still explain its score (`0107`), so if one ever reads these figures
-- its foreign key should refuse this rollback rather than let it empty the record.
DELETE FROM value_citation
WHERE  value IN (SELECT id FROM value WHERE data_source = 'wri');

DELETE FROM value_quantity
WHERE  value_id IN (SELECT id FROM value WHERE data_source = 'wri');

DELETE FROM value WHERE data_source = 'wri';

DELETE FROM data_source WHERE id = 'wri';
