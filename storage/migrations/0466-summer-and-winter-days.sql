-- Two climate attributes beside the yearly average: how warm a summer day and a winter day get.
-- Asked for by the household on 2026-09-11 (Q213).
--
-- **Why.** A yearly average hides the extremes a year is lived in: Romania (12.6 °C) and
-- Belgium (11.9 °C) read alike, while Bucharest's summers pass 30 °C and its winters freeze, and
-- Brussels is mild all year. The household kept the yearly average and added these two.
--
-- **Daytime, as the household specified -- never the night.** Each is the average daily high
-- over a meteorological season: June to August for summer, December to February for winter.
-- The winter figure is therefore how warm a winter *day* gets, the temperature met walking out
-- at midday, not the night-time minimum.
--
-- **Descriptive until the household chooses how to score them.** No criterion is added here:
-- which range is comfortable, and what share of the climate pillar each takes, are the
-- household's to decide against real figures, as every anchor in this catalog has been.
-- depends: 0465-hours-and-networks-anchored

INSERT INTO attribute (id, pillar, level, value_type, name, description, max_age, manual_entry) VALUES
    ('country.summer_daytime_temperature', 'climate', 'country', 'Quantity',
     'Summer daytime temperature', 'average daily high, June to August, °C', interval '60 months', false),
    ('country.winter_daytime_temperature', 'climate', 'country', 'Quantity',
     'Winter daytime temperature', 'average daily high, December to February, °C', interval '60 months', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit) VALUES
    ('country.summer_daytime_temperature', 'Quantity', 'celsius'),
    ('country.winter_daytime_temperature', 'Quantity', 'celsius')
ON CONFLICT DO NOTHING;

INSERT INTO attribute_allowed_range (attribute, min_value, max_value) VALUES
    ('country.summer_daytime_temperature', -20, 50),
    ('country.winter_daytime_temperature', -30, 40)
ON CONFLICT DO NOTHING;

INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.summer_daytime_temperature', 'open_meteo', 1),
    ('country.winter_daytime_temperature', 'open_meteo', 1)
ON CONFLICT (attribute, data_source) DO UPDATE SET rank = EXCLUDED.rank;
