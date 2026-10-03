-- 32 stored figures that scored nothing, and nothing said so.
--
-- `country.forest_cover` has held a World Bank figure for every candidate since P4, and both
-- shipped sets score it `fixed` with **no scale anchors**. A `fixed` criterion with fewer than
-- two anchors cannot place a figure, so `_scores_by_criterion` returns an empty column: the
-- drill-down reads `normalised_score: null, effective_weight: 0.0, contribution: 0.0` beside a
-- figure that is present, correct and on screen.
--
-- **This is the fault `0489` and `0490` were written to avoid**, found in production data the
-- day after. The guard that caught those -- 
-- `test_every_transcribed_attribute_has_a_criterion_that_can_actually_score_it` -- scopes itself
-- to attributes answered by a transcribed table, because that is where it was first needed.
-- `forest_cover` comes from an API and sat outside it. The guard is widened in the same change,
-- to every attribute that has a stored value, which is the rule it always meant.
--
-- `percentile` rather than anchors chosen for the same reason as the coastline: forest cover
-- runs from about 1% in Malta to over 70% in Finland and Sweden, and no one has said what share
-- is "good". Ranking the 32 against each other is the honest reading of a figure whose absolute
-- scale nobody has set, and it needs no anchors to be chosen before it works.
-- depends: 0490-elevation-comes-from-the-agencies-that-survey-it

UPDATE criterion SET normalisation_method = 'percentile'
WHERE  attribute = 'country.forest_cover';
