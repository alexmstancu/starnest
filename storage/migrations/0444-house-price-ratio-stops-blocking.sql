-- `house_price_to_income_ratio` stops blocking the shipped set, and becomes the type it is.
--
-- **Why it cannot block.** `reqs.md` 7.5 chose the blocking attributes on two conditions
-- together: the score means little without them, *and* the source covers all 32 -- "so a gap
-- signals a broken fetch rather than a genuinely undocumented place". No source covers this one
-- at all as the catalog specifies it. OECD, checked 2026-09-11, publishes only how the ratio has
-- *changed*: an index with 2015 = 100 for every country, or a percentage of each country's own
-- long-run average. Portugal at 133 and Germany at 87 say Portugal is further above its own
-- history, not that it is less affordable than Germany. So as a blocking attribute it could only
-- ever make every candidate unscoreable. Decided 2026-09-11 (Q204).
--
-- **It stays in the catalog, unanswered, and the long-term answer is recorded.** Derive it --
-- an absolute house price level over median income, from sources whose definitions line up --
-- is post-MVP work (`devplan.md` 8). It keeps its criterion and its weight, so the day a figure
-- arrives it counts without anyone remembering to add it back.
--
-- **And it was mistyped.** A price-to-income ratio is a *multiple* -- "a home costs 8.2 years
-- of income" -- with no ceiling. `Ratio` means a share of something and is capped at 100. The
-- same class of fault `0443` fixed for `cost_of_living_index`: the type described a different
-- kind of number than the name.
--
-- Deleted and reinserted rather than updated, because `criterion.value_type` is pinned to the
-- attribute's by a composite foreign key.
-- depends: 0443-cost-of-living-becomes-a-quantity

-- **Locked first** (BE-A1): a set edit committed between the copy below and its delete was
-- replaced by the older copy. SHARE ROW EXCLUSIVE waits for an edit in flight and holds off
-- new ones until this commits, while reads go on.
LOCK TABLE criterion, criterion_scale_anchor, criterion_threshold_range
    IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO unit (id, name) VALUES ('years_of_income', 'Years of income')
ON CONFLICT (id) DO NOTHING;

CREATE TEMPORARY TABLE held_criterion ON COMMIT DROP AS
SELECT * FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';

-- **The anchors and the matching threshold come across too** (D69), as every other rule does
-- (RE-3): they hang off the criterion's id, which the delete below ends, so they are held by
-- set and put back on the criterion that replaces it. Left behind, they stopped the delete on
-- their foreign keys; deleted, they would be a person's rules lost.
CREATE TEMPORARY TABLE held_anchor ON COMMIT DROP AS
SELECT judged.criteria_set, anchor.input_value, anchor.score, anchor.label
FROM   criterion_scale_anchor AS anchor
JOIN   criterion AS judged ON judged.id = anchor.criterion
WHERE  judged.attribute = 'country.house_price_to_income_ratio';

CREATE TEMPORARY TABLE held_threshold ON COMMIT DROP AS
SELECT judged.criteria_set, threshold.min_value, threshold.max_value
FROM   criterion_threshold_range AS threshold
JOIN   criterion AS judged ON judged.id = threshold.criterion
WHERE  judged.attribute = 'country.house_price_to_income_ratio';

DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.house_price_to_income_ratio');
DELETE FROM criterion_threshold_range
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.house_price_to_income_ratio');

DELETE FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';
DELETE FROM attribute_ratio_parameter WHERE attribute = 'country.house_price_to_income_ratio';

UPDATE attribute
SET    value_type = 'Quantity',
       description = 'price of a home as a multiple of annual household income'
WHERE  id = 'country.house_price_to_income_ratio';

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.house_price_to_income_ratio', 'Quantity', 'years_of_income')
ON CONFLICT (attribute) DO UPDATE SET unit = EXCLUDED.unit;

-- Every criterion that held it comes back with the new type, every rule a person put on it --
-- the same number is being described, so a lock, a band and its zero points all still mean
-- what they meant (RE-3) -- and, the point of this migration, no longer blocking.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, breakdown_option, is_scored, weight,
    weight_locked, goal, target_range_min, target_range_max, zero_score_below,
    zero_score_above, normalisation_method, reducer_mode, blocks_if_missing)
SELECT criteria_set, attribute, pillar, 'Quantity', breakdown_option, is_scored, weight,
       weight_locked, goal, target_range_min, target_range_max, zero_score_below,
       zero_score_above, normalisation_method, reducer_mode, false
FROM   held_criterion;

INSERT INTO criterion_scale_anchor (criterion, input_value, score, label)
SELECT judged.id, held.input_value, held.score, held.label
FROM   held_anchor AS held
JOIN   criterion AS judged
       ON judged.criteria_set = held.criteria_set AND judged.attribute = 'country.house_price_to_income_ratio';

INSERT INTO criterion_threshold_range (criterion, value_type, min_value, max_value)
SELECT judged.id, judged.value_type, held.min_value, held.max_value
FROM   held_threshold AS held
JOIN   criterion AS judged
       ON judged.criteria_set = held.criteria_set AND judged.attribute = 'country.house_price_to_income_ratio';
