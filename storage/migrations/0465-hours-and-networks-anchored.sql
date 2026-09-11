-- Anchors for the three W4-F criteria, from the household's notes of 2026-09-11 (Q212).
--
-- | Criterion | Anchors | What the real figures do |
-- |---|---|---|
-- | average_working_hours | 40 h -> 100, 48 h -> 0 | Romania (40.2) 98, Switzerland (42.6) 68, the Netherlands (38.0) 100 |
-- | rail_network_density | 0 -> 0, 100 -> 100 km per 1,000 km2 | Romania 45, Germany 100, Norway 11 |
-- | road_network_quality | 0 -> 0, 40 -> 100 km per 1,000 km2 | Romania 12, Germany 93, the Benelux 100 |
--
-- **Working hours is the household's own reading, not the option offered.** Proposed was 38 h
-- -> 100 and 42 h -> 0; the household found 0 at 42 hours "too aggressive": 40 is the standard
-- and 42 "not too much". So 40 scores full marks and the zero sits at 48, the average weekly
-- maximum of the EU Working Time Directive (2003/88/EC, article 6) -- a limit written in law
-- rather than one chosen here -- which puts 42 hours at 75.
--
-- **The two densities are kept for the MVP and rethought after it** (`devplan.md` 8): dividing
-- a network by land area punishes a country for its empty land, and the household's real
-- question is whether the main places are connected.
-- depends: 0464-the-places-a-country-is-measured-at

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, anchor.input_value, anchor.score
FROM   criterion AS c
JOIN   (VALUES
            ('country.average_working_hours', 40,  100),
            ('country.average_working_hours', 48,  0),
            ('country.rail_network_density',  0,   0),
            ('country.rail_network_density',  100, 100),
            ('country.road_network_quality',  0,   0),
            ('country.road_network_quality',  40,  100)
        ) AS anchor (attribute, input_value, score)
       ON anchor.attribute = c.attribute
WHERE  c.criteria_set = 'local_employment'
ON CONFLICT (criterion, input_value) DO UPDATE SET score = EXCLUDED.score;
