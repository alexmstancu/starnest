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
DELETE FROM value WHERE data_source = 'wri';

DELETE FROM data_source WHERE id = 'wri';
