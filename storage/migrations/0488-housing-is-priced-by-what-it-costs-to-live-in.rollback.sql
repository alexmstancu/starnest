-- Back to a purchase ratio nothing can answer.
--
-- **Every column is carried, not retyped.** The first version hardcoded `percentile`, and
-- `house_price_to_income_ratio` has been `fixed` since `0104` -- so rolling back would have
-- restored it under a method it never had, quietly undoing the very fault `0489` and `0490`
-- exist to catch. `goal`, `is_scored`, `weight_locked` and `blocks_if_missing` were hardcoded
-- beside it for the same reason and are now carried too. The forward half's whole argument is
-- that a weight must be transferred rather than typed; a rollback is not exempt from it.
--
-- `0444` held the same columns in a temp table while it lifted and replaced this attribute,
-- which is the pattern this follows one step more cheaply: the replacement row still exists
-- when this runs, so it can simply be read.
UPDATE attribute SET lifecycle_status = 'active'
WHERE  id = 'country.house_price_to_income_ratio';

INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
SELECT replacing.criteria_set, 'country.house_price_to_income_ratio', 'Quantity', 'housing',
       replacing.weight, replacing.goal, 'fixed', replacing.is_scored,
       replacing.weight_locked, replacing.blocks_if_missing
FROM   criterion AS replacing
WHERE  replacing.attribute = 'country.housing_price_level';

DELETE FROM criterion WHERE attribute = 'country.housing_price_level';
DELETE FROM stand_in WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute_source_priority WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute_quantity_parameter WHERE attribute = 'country.housing_price_level';

-- The figures go before the attribute they describe: `value_attribute_fkey` refuses otherwise,
-- and they are what this migration brought into existence.
--
-- **And a figure's own rows go before the figure**, which is the half this missed. Eleven
-- tables reference `value` and none cascades, so `DELETE FROM value` alone failed on
-- `value_quantity_value_fkey` for all 211 stored figures. It passed every check we had because
-- a figure-free database deletes nothing here.
--
-- `candidate_attribute_score.used_value` is deliberately not cleared: a saved evaluation is a
-- frozen record that must still explain its score (`0107`), so if one ever reads these figures
-- its foreign key should refuse this rollback rather than let it empty the record.
DELETE FROM value_citation
WHERE  value IN (SELECT id FROM value WHERE attribute = 'country.housing_price_level');

DELETE FROM value_quantity
WHERE  value_id IN (SELECT id FROM value WHERE attribute = 'country.housing_price_level');

DELETE FROM value WHERE attribute = 'country.housing_price_level';
DELETE FROM attribute WHERE id = 'country.housing_price_level';
