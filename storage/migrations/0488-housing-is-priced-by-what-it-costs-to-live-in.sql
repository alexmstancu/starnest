-- Housing's second-heaviest criterion asked a question no source answers, and the wrong one.
--
-- `country.house_price_to_income_ratio` -- a home's price as a multiple of annual income --
-- has carried 30.8% of the housing pillar with **no figure for any country**. Both routes
-- `catalog-blockers.md` item 3 offered were probed on 2026-10-02 and both fail:
--
--   (a) Eurostat does publish a price-to-income series, `tipsho60`, which that document said
--       did not exist. **None of its three units is a ratio**: an index 2015 = 100, a
--       percentage of each country's own long-term average, and a rate of change. It is the
--       same OECD-derived series, so swapping the source priority changes nothing.
--   (b) An average transaction price *is* derivable -- `prc_hpi_hsva` (sales value, EUR) over
--       `prc_hpi_hsna` (sales number) -- and across every year and every purchase category it
--       covers **14 of our 32**, missing Germany, Spain, Italy, Switzerland, Sweden, Poland,
--       Luxembourg and Czechia. Under half the roster compares two groups on different
--       evidence, which is what retired the job-posting counts in `0487`.
--
-- **And it was measuring the wrong thing.** Housing is around half of what a household spends
-- in a month, and not one of this pillar's three attributes said what that half would cost:
-- overburden is a *population statistic* (the share of people paying over 40% of income),
-- overcrowding is *space*, and price-to-income is a *purchase*. Somebody deciding where to
-- move rents before they buy, and wants to know the price.
--
-- `country.housing_price_level` is Eurostat's price level index for COICOP `A0104`, housing,
-- water, electricity, gas and other fuels -- **rent and utilities, the monthly bill** --
-- against an EU27 average of 100. It is the mechanism `cost_of_living_index` already uses
-- (`0443`), one category narrower, and it discriminates properly: Bulgaria 38.5 to Switzerland
-- 215.4, a spread of 5.6x.
--
-- **A price level index has a base, not a range**, so it is a `Quantity` whose unit names the
-- base rather than an `Index` -- the distinction `0443` drew and the reason that attribute was
-- retyped. The goal is `minimise`: cheaper housing is better for a household with a budget.
--
-- Coverage is **30 of 32 directly**, plus Liechtenstein from Switzerland on the reason already
-- recorded for `cost_of_living_index`. The United Kingdom is the one gap: it left the PPP
-- programme's category breakdown, the COICOP 1999 vintage stops at 2020, and a figure from a
-- different vintage five years stale would be a second quantity wearing this one's name.
-- depends: 0487-career-is-measured-by-the-workforce-that-exists

INSERT INTO attribute (id, name, level, pillar, value_type, description, max_age,
                       lifecycle_status, manual_entry)
VALUES ('country.housing_price_level', 'Housing price level', 'country', 'housing', 'Quantity',
        'what housing, water and energy cost against an EU27 average of 100',
        '2 years', 'active', false);

INSERT INTO attribute_quantity_parameter (attribute, value_type, unit)
VALUES ('country.housing_price_level', 'Quantity', 'eu27_average_100');

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.housing_price_level', 'eurostat', 1);

-- Liechtenstein pays Swiss prices for the same reason its cost of living does.
INSERT INTO stand_in (candidate, attribute, substitute_candidate, level, reason)
VALUES ('country.liechtenstein', 'country.housing_price_level', 'country.switzerland', 'country',
        'Eurostat does not survey Liechtenstein''s prices. It shares a customs and currency '
        'union with Switzerland, and its housing market is continuous with the Swiss one '
        'across the Rhine.');

-- **The retired attribute's weight, taken from the row rather than typed in.** A literal here
-- would be a number read off one database and asserted of every other, and the two differ: a
-- browser test moves a weight and puts it back, a hand-edit through the API is a stored change,
-- so the live catalog drifts from what the migrations seed. Selecting the weight transfers
-- whatever each set actually holds, in every set that holds one, and the pillar still sums to
-- 100 wherever this runs. Found by the suite, which builds its database from these files.
INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
SELECT retiring.criteria_set, 'country.housing_price_level', 'Quantity', 'housing',
       retiring.weight, 'minimise', 'percentile', true, false, false
FROM   criterion AS retiring
WHERE  retiring.attribute = 'country.house_price_to_income_ratio';

DELETE FROM criterion WHERE attribute = 'country.house_price_to_income_ratio';

UPDATE attribute SET lifecycle_status = 'retired'
WHERE  id = 'country.house_price_to_income_ratio';
