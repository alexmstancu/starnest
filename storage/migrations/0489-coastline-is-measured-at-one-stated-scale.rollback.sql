-- Back to two sources that cannot answer it.
DELETE FROM attribute_source_priority WHERE attribute = 'country.coastline_access';

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.coastline_access', 'natural_earth', 1),
       ('country.coastline_access', 'eurostat', 2);

DELETE FROM data_source WHERE id = 'wri';

UPDATE criterion SET normalisation_method = 'fixed'
WHERE  attribute = 'country.coastline_access';
