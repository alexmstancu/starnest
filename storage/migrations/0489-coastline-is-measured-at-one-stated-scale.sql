-- `country.coastline_access` had two sources declared and no figure from either.
--
-- Its priority was `natural_earth` rank 1, `eurostat` rank 2. Natural Earth is a vector
-- dataset, not a table of lengths; Eurostat publishes an EU aggregate (136 106 km) and a
-- sea-basin split, not a per-country coastline. The CIA World Factbook, which everyone else
-- reprints, was discontinued in February 2026 (P39).
--
-- **The objection to transcribing one was never availability, it was comparability.** Coastline
-- length depends on the resolution it is measured at -- the coastline paradox -- so a column
-- assembled from sources using different scales is not a measurement of anything. Wikipedia
-- says this of the Factbook's own figures: the scales "are not stated, nor is it known whether
-- the figures are all reported using the same scale, thus the figures are necessarily not
-- comparable across different countries."
--
-- **WRI's column answers exactly that.** It was computed in 2000 from the World Vector
-- Shoreline (US Defense Mapping Agency, 1989) at **1:250 000 for every country**, by one GIS
-- against one database. The disagreement with the Factbook is large and is the evidence that
-- the two are independent: Finland 1 250 km against 31 119, Sweden 3 218 against 26 384.
--
-- Five sites that look like independent sources -- GlobalFirepower, GlobalMilitary, WorldoStats,
-- Listbase, Grokipedia -- all reprint the Factbook column. Norway at exactly 83 281 km is the
-- tell. They are one ruled-out source wearing five hats.
--
-- The land area under the ratio is Eurostat `reg_area3`, which covers all 32 and lets the
-- household's territory ruling be *computed* rather than judged: France is total minus the
-- overseas regions `FRY`, Norway total minus Svalbard `NO0B` (323 810 km2 against the official
-- mainland 323 808). The cost is that the coastline and the area follow different territorial
-- conventions for those two countries; the table says so in its `workings` rather than hiding
-- it, and `confidence: medium` is set for that and for the archived route.
--
-- Liechtenstein is landlocked, so 0 is a measurement rather than a gap. Seven of the 32 are.
-- depends: 0488-housing-is-priced-by-what-it-costs-to-live-in

INSERT INTO data_source (id, name, source_kind, default_priority, reliability_tier, is_enabled)
VALUES ('wri', 'World Resources Institute', 'structured', 55, 'research_index', true);

-- Ahead of the two that cannot answer it. They keep their places rather than being deleted:
-- Natural Earth is the live route if the coastline is ever computed rather than transcribed,
-- which is what P39 wanted and what GSHHG -- the maintained successor to the very same World
-- Vector Shoreline -- would make possible.
--
-- **Rewritten rather than shifted.** `UNIQUE (attribute, rank)` is checked per row, so
-- `rank = rank + 1` collides with the row it is about to vacate. Three rows are cheaper to
-- state than a deferrable constraint is to reason about.
DELETE FROM attribute_source_priority WHERE attribute = 'country.coastline_access';

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.coastline_access', 'wri', 1),
       ('country.coastline_access', 'natural_earth', 2),
       ('country.coastline_access', 'eurostat', 3);

-- **And the criterion has to be able to place the figures.** Both sets scored this `fixed`
-- with no anchors chosen, which cannot normalise anything -- so the transcribed values would
-- have been stored, shown, and scored nothing at all, silently. `percentile` needs no anchors:
-- it ranks the 32 against each other, which is the honest reading of a figure whose absolute
-- scale means little (is 7 km per 1000 km2 good?) but whose ordering means a lot. Caught by
-- `test_every_transcribed_attribute_has_a_criterion_that_can_actually_score_it`, which exists
-- because a source that fetches and scores nothing looks exactly like a source that works.
UPDATE criterion SET normalisation_method = 'percentile'
WHERE  attribute = 'country.coastline_access';
