DELETE FROM attribute_source_priority
WHERE attribute = 'country.total_tax_rate_effective' AND data_source = 'eurostat_estimate';
DELETE FROM data_source WHERE id = 'eurostat_estimate';
