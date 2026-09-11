-- `country.homicide_rate` is normalised `percentile`, not `as_is`. A correction of `0442`.
--
-- **What was wrong, and it reached a ranking.** `0442` created the homicide rate out of
-- `crime_safety_index` and copied the old criterion's method with it -- `as_is`, which was right
-- for Numbeo's 0-100 index. `as_is` treats a figure as already being a score. On a rate per
-- 100,000 that means Romania's 1.12 was read as a score of 1.12 out of 100, then inverted for
-- `minimise` to 99. **Every country scored between 97 and 100 on homicide**: a criterion carrying
-- half the safety pillar that discriminated nothing and looked entirely ordinary. It was visible
-- in the first ranking the shipped set ever produced, for about an hour.
--
-- `reqs.md` 3.3a had always said a `Quantity` allows `fixed` and `percentile` only. Nothing read
-- it. `test_every_scored_criterion_uses_a_method_its_value_type_allows` now does, from the
-- document itself, and this was the only criterion in the catalog it refused.
--
-- **`percentile` rather than `fixed`**, because `fixed` needs anchors, anchors are the household's
-- to choose against the real distribution (D6(C), Q206), and without them this blocking criterion
-- would stop the shipped set scoring at all. Percentile is legal, invents nothing, and says the
-- true thing -- where each country stands among the others -- until anchors are chosen.
-- depends: 0447-the-first-anchors

UPDATE criterion
SET    normalisation_method = 'percentile'
WHERE  criteria_set = 'local_employment' AND attribute = 'country.homicide_rate';
