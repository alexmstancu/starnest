-- Cost of living joins the demonstration set, now that it can hold a value.
--
-- `reqs.md` 7.6 calls affordability "the question the app exists to answer", and `minimal` --
-- the only set that scores today -- has been answering everything except it. `0443` made the
-- attribute storable and Eurostat `tec00120` answers 31 of 32; this makes it count.
--
-- It deepens the economics pillar rather than opening one, which is a lower priority under D7
-- than the four streams before it. It is here anyway because it is the single attribute the
-- household cares most about, and because a demonstration set that ranks on governance and
-- broadband while ignoring prices demonstrates the wrong thing.
--
-- `minimise` and `percentile`. Liechtenstein has no figure and loses this criterion's weight to
-- redistribution, as it does for every Eurostat series.
-- depends: 0443-cost-of-living-becomes-a-quantity

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'minimal', a.id, a.pillar, a.value_type, true, 50, 'minimise', 'percentile', false
FROM   attribute AS a
WHERE  a.id = 'country.cost_of_living_index'
ON CONFLICT (criteria_set, attribute) DO UPDATE
SET weight = EXCLUDED.weight, goal = EXCLUDED.goal;

-- Economics now holds two criteria, so its 100 splits between them.
UPDATE criterion SET weight = 50
WHERE criteria_set = 'minimal' AND attribute = 'country.economic_outlook';
