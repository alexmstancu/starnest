-- The attribute that could not hold a value becomes one that can.
--
-- **What was wrong.** `country.cost_of_living_index` was typed `Index`, and an `Index` payload
-- requires `scale_min` and `scale_max` and refuses any figure outside them. This attribute
-- declared neither -- `attribute_index_parameter` had no row for it -- so **no value of any
-- kind could be stored against it**, by any source or by hand. It is one of the seven
-- `blocks_if_missing` attributes, so the shipped set could never have scored a candidate.
-- Decided 2026-09-09 (docs/catalog-blockers.md item 1).
--
-- **Why no bounds were ever declared.** The description says "Eurostat PLI, EU27 = 100", and
-- that is a *base*, not a range. A price level index says how a country compares with the
-- European average: Romania is 65.1, Germany 108.3, Iceland 173.5, and there is no such thing
-- as a maximum expensiveness. Declaring 0-200 would have silently refused Iceland; declaring
-- 0-250 would have put a ceiling in the catalog that no publisher ever wrote, which is exactly
-- what D6 refused to do for scale anchors.
--
-- **`Quantity` is the only payload that fits.** Its magnitude is unbounded and its unit carries
-- the meaning. `Ratio` does not fit either: it is capped at 100, so it would refuse every
-- country from Germany upward. `life_satisfaction` sets the precedent -- a Cantril ladder 0-10
-- is a `Quantity`, not an `Index`, even though it has a published range -- because **this
-- ontology reserves `Index` for figures whose bounds do the work.**
--
-- `percentile` rather than `as_is`: `as_is` maps a published figure from its own declared
-- bounds (D6-A), and there are none to map from. What counts as *cheap* is a judgement about a
-- distribution, answered per attribute once the distribution exists (D6-C).
--
-- The criterion is deleted and reinserted rather than updated, because `criterion.value_type`
-- is pinned to the attribute's by a composite foreign key -- the idiom that stops the two
-- drifting apart. It does its job here: the attribute's type cannot change while a criterion
-- still claims the old one.
-- depends: 0442-crime-splits-into-a-rate-and-a-composite

INSERT INTO unit (id, name) VALUES
    ('eu27_average_100', 'Index where the EU27 average is 100')
ON CONFLICT (id) DO NOTHING;

DELETE FROM criterion WHERE attribute = 'country.cost_of_living_index';

UPDATE attribute
SET    value_type = 'Quantity',
       description = 'price level relative to the EU27 average, which is 100'
WHERE  id = 'country.cost_of_living_index';

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.cost_of_living_index', 'Quantity', 'eu27_average_100')
ON CONFLICT (attribute) DO UPDATE SET unit = EXCLUDED.unit;

-- Same weight, same goal, same blocking role. Only the type and the method change.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal, normalisation_method,
    blocks_if_missing)
SELECT 'local_employment', a.id, a.pillar, a.value_type, true, 35, 'minimise', 'percentile', true
FROM   attribute AS a
WHERE  a.id = 'country.cost_of_living_index';
