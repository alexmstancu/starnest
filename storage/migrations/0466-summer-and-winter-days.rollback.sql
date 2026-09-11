-- Refuses, through the value table's foreign key, while any figure for either is stored:
-- values are never discarded (reqs.md 3.6).
DELETE FROM attribute_source_priority WHERE attribute IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
DELETE FROM attribute_allowed_range WHERE attribute IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
DELETE FROM attribute_quantity_parameter WHERE attribute IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
DELETE FROM attribute WHERE id IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
