-- `country.elevation_range` had one source declared and no figure from it.
--
-- Its priority was `copernicus` rank 1, which is a digital elevation model rather than a table
-- of extremes. Every route to a per-country figure was tested and failed (P39, extended):
--
--   * **GMTED2010** publishes minimum and maximum as *per-cell rasters*. No country summary.
--   * **The EEA's EU-DEM elevation breakdown** is archived and superseded, GeoTIFF only, and
--     gives five relief typologies by height and slope -- not extremes.
--   * **GeoNames**, which this repository already depends on for population centres and was
--     therefore the cheapest possible win, is simply wrong here: Grossglockner reads 3 736 m
--     against a surveyed 3 798, and the Netherlands has no peak features and carries the -9999
--     nodata sentinel. Downloaded and parsed rather than assumed.
--   * **Open Topo Data** against EU-DEM works and reads low -- Mont Blanc 4 780 m against
--     4 805.59 -- and needs summit coordinates we do not have; a near-miss on Grossglockner
--     returned 3 619 m, so coordinate error dominates.
--   * **Peakbagger** answers scripts with 403.
--
-- **So it is transcribed from the agencies that survey it**, one per country: Ordnance Survey
-- for Ben Nevis, CUZK for Snezka, Statistik Austria, GUS, INSSE, stat.gov.lv, the Liechtenstein
-- statistics portal, the Bavarian environment agency for the Zugspitze. `national_statistics`
-- `national_statistics` is the nearest source this catalog has for them. It was seeded at
-- priority 40 by `0101` and **had no attribute pointing at it until now** -- this is its first
-- user, not a source it shared. Eight of the 32 rows do not come from a statistics office at
-- all (a peer-reviewed survey, a university paper, an encyclopedia, a heritage site, a
-- university release, and an Italian regional government for Mont Blanc), and the table's
-- `# route:` line names every one. That attribution is the weakest claim here and it is
-- stated rather than implied.
-- are Wikipedia-routed and say so in their own rows, as `statutory_paid_leave` does.
--
-- **The Factbook's fingerprints were found and removed.** Luxembourg's low point is widely
-- printed as 133 m, which is the Factbook's; `luxembourg.public.lu` and *Le Luxembourg en
-- chiffres* both say Wasserbillig at **130**. Seven countries have a point below sea level, not
-- the three a first pass assumed: Poland -1.8, the United Kingdom -2.75, Sweden -2.32 and Italy
-- -3.44 join the Netherlands, Denmark and Germany.
--
-- Three figures are contested and the table says so rather than choosing quietly. Snezka's
-- natural summit stands on Polish territory and the Czech-side point is about 10 cm lower, which
-- is below this attribute's precision. Mont Blanc's sovereignty is disputed and its snow cap is
-- re-surveyed biennially -- Italy's highest peak wholly within Italy is Gran Paradiso at 4 061 m.
-- Kebnekaise's southern peak is a glacier that has lost about 30 m since 1951, so the figure is
-- the ice-free north peak, which has held the title since 2019.
--
-- **And the criterion is switched off `fixed`**, which had no anchors and so could place no
-- figure at all: the transcribed values would have been stored, displayed and scored nothing,
-- silently. The same fault `0489` found on the coastline.
-- depends: 0489-coastline-is-measured-at-one-stated-scale

DELETE FROM attribute_source_priority WHERE attribute = 'country.elevation_range';

INSERT INTO attribute_source_priority (attribute, data_source, rank)
VALUES ('country.elevation_range', 'national_statistics', 1),
       ('country.elevation_range', 'copernicus', 2);

UPDATE criterion SET normalisation_method = 'percentile'
WHERE  attribute = 'country.elevation_range';
