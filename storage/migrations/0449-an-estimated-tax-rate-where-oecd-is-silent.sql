-- A second source for the total tax rate: an estimate from Eurostat's own figures, ranked below
-- OECD, at low confidence. Decided 2026-09-11 (Q207).
--
-- **Why it exists.** OECD Taxing Wages does not cover Romania, Bulgaria, Croatia, Cyprus or
-- Malta, so under the shipped set those five could not be ranked -- Romania being the household's
-- home and the anchor of every comparison. Eurostat covers all five, but publishes the full tax
-- wedge only at 67% of the average wage, where Q205 reads it at 167%.
--
-- **How it is estimated.** From the 67% wedge and the 67% employee components, the employer's
-- contribution rate is backed out; it is then applied to the 167% components. No rate is typed in
-- from anywhere: every input is a Eurostat figure. Tested against OECD's published 167% wedge on
-- twelve countries it covers, it lands within one point where employer contributions are a flat
-- rate (Portugal, Czechia, Spain, Italy, Sweden, Finland) and misses by one to eight where they
-- are capped above or reduced below that income (Germany, Austria, Belgium; France, Poland, the
-- Netherlands). Romania and Croatia are flat -- the data recovers their statutory 2.25% and 16.5%
-- unprompted -- so theirs should be close. Bulgaria and Malta cap contributions below 167% of
-- their average wage, so theirs are probably one to three points too high.
--
-- **Low confidence, and the household chose to take all five on those terms**, rather than only
-- the two where the method is exact. The confidence and the full working travel with every
-- figure, so the caveat is on the screen and not only here.
--
-- **Ranked second, never first.** Where OECD publishes a figure it stays the active one, and the
-- estimate is stored beside it as a visible second opinion -- the non-destructive, multi-source
-- rule doing its job, with no list of countries anywhere saying who needs the estimate.
-- depends: 0448-homicide-is-not-already-a-score

INSERT INTO data_source (id, name, source_kind, default_priority, reliability_tier)
VALUES ('eurostat_estimate', 'Estimated from Eurostat tax-benefit figures', 'structured', 65, 'derived')
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.total_tax_rate_effective', 'eurostat_estimate', 2)
ON CONFLICT (attribute, data_source) DO UPDATE SET rank = EXCLUDED.rank;
