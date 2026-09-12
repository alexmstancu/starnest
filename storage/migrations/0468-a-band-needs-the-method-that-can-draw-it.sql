-- A `target_range` goal only means something under the `fixed` method. Found 2026-09-12,
-- reading the scoring for patterns rather than for bugs.
--
-- **The combination scored, and scored something else.** `percentile` ranks a column by
-- standing and knows nothing of a band, so the band was silently ignored and the candidates
-- were ordered as though higher were better. `as_is` reads the figure as a score and inverts it
-- unless the goal is `maximise`, so a target range came out scored as a minimisation: 26 °C in
-- an 18-26 band scoring 74. A plausible number meaning the opposite of what was asked for is
-- the exact failure reqs.md 10 exists to prevent, and nothing refused it -- not the schema, not
-- the domain, not the scoring.
--
-- Nothing shipped uses it: the three temperature criteria are the only `target_range` rows and
-- all three normalise `fixed` (0467). It was reachable through the API, which takes `goal` and
-- `normalisation_method` as independent fields.
--
-- The same CHECK on the frozen copy, for the reason 0107 gave: an evaluation stores the
-- interpretation it used, and a combination the live catalog refuses must not be storable as a
-- record of what was scored.
-- depends: 0467-summer-and-winter-days-scored

ALTER TABLE criterion ADD CONSTRAINT criterion_a_band_needs_a_fixed_scale
    CHECK (goal <> 'target_range' OR normalisation_method = 'fixed');

ALTER TABLE evaluation_criterion ADD CONSTRAINT evaluation_criterion_a_band_needs_a_fixed_scale
    CHECK (goal <> 'target_range' OR normalisation_method = 'fixed');
