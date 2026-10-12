-- Anchors for the two `fixed` criteria that just gained figures, so the data scores rather than
-- merely lands. `annual_sunshine_hours` (national met-office normals, transcribed) and
-- `international_air_connectivity` (OpenFlights, computed) were `fixed` with no anchors, which
-- `test_catalog_arithmetic` correctly refuses once figures exist: a `fixed` criterion with fewer
-- than two anchors cannot place a figure, so the column would read as covered and score nothing.
--
-- Same three steps as 0447/0462: the observed range across the 32, an anchor pair, its effect on
-- real countries. Unlike 0462 (which anchored `local_employment` only) this anchors BOTH shipped
-- sets, because both score these two attributes and both were left anchorless.
--
-- | Criterion | Anchors | What the real figures do |
-- |---|---|---|
-- | annual_sunshine_hours | 1300 h -> 0, 3200 h -> 100 | Iceland 1340 -> 2, UK 1618 -> 17, Germany 1719 -> 22, Spain 2740 -> 76, Malta 2954 -> 87, Cyprus 3347 -> 100 (capped). Nordic/Isles low, Mediterranean high. |
-- | international_air_connectivity | 20 -> 0, 300 -> 100 | Slovakia 18 -> 0, Slovenia 22 -> 1, Iceland 32 -> 4, NL 253 -> 83, Germany 314 / France 316 / UK 355 -> 100 (the big hubs tie at the top, where the difference stops mattering). |
--
-- Caveats seen and accepted: the air figure is OpenFlights' frozen-2017 route graph, so it lands
-- stale and the active-value rule already ranks it below any fresher source; the sunshine figure
-- is a population-weighted mean of city normals, a few on older periods (devplan/catalog-blockers).
-- Scores on a scale of 100 (`settings.score_scale_max`). **Provisional, like every threshold in
-- this project** -- data-informed starting points the household can retune, not measurements.
-- depends: 0496-mild-now-brutal-later-meets-the-figures

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, anchor.input_value, anchor.score
FROM   criterion AS c
JOIN   (VALUES
            ('country.annual_sunshine_hours',         1300, 0),
            ('country.annual_sunshine_hours',         3200, 100),
            ('country.international_air_connectivity', 20,   0),
            ('country.international_air_connectivity', 300,  100)
        ) AS anchor (attribute, input_value, score)
       ON anchor.attribute = c.attribute
WHERE  c.criteria_set IN ('local_employment', 'remote_only')
  AND  c.normalisation_method = 'fixed'
ON CONFLICT (criterion, input_value) DO UPDATE SET score = EXCLUDED.score;

-- Refuse rather than seed half a scale: each of the four criteria (two attributes x two sets) must
-- end with at least its two anchors, so a typo in an attribute id or a set that does not score the
-- attribute fails here instead of leaving a `fixed` criterion unplaceable with figures behind it.
DO $$
DECLARE
    under_anchored integer;
BEGIN
    SELECT count(*) INTO under_anchored
    FROM   criterion c
    WHERE  c.criteria_set IN ('local_employment', 'remote_only')
      AND  c.attribute IN ('country.annual_sunshine_hours', 'country.international_air_connectivity')
      AND  c.normalisation_method = 'fixed'
      AND  (SELECT count(*) FROM criterion_scale_anchor a WHERE a.criterion = c.id) < 2;
    IF under_anchored <> 0 THEN
        RAISE EXCEPTION 'anchoring left % fixed criteria with fewer than two anchors', under_anchored;
    END IF;
END $$;
