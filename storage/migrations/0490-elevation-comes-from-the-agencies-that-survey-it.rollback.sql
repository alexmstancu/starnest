-- Back to a digital elevation model that publishes no per-country extremes.
UPDATE criterion SET normalisation_method = 'fixed'
WHERE  attribute = 'country.elevation_range';

DELETE FROM attribute_source_priority WHERE attribute = 'country.elevation_range';

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.elevation_range', 'copernicus', 1);
