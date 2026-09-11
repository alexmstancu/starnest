-- The first scale anchors this catalog has ever shipped: the total tax rate, 35% to 55%.
--
-- **Chosen by the household on 2026-09-11, against the real distribution** (Q206) -- which is
-- the condition D6(C) set for any anchor: chosen per attribute once its data has landed, never
-- before. Twenty-six countries from OECD Taxing Wages: Switzerland 27.4%, median 43.8%, Belgium
-- 58.6%, and half of Europe between 41.7% and 48.9%.
--
-- **35% scores full marks and 55% scores nothing, linearly between**: every point of tax is five
-- points of score. It frames the crowded middle rather than the extremes -- 42% against 48%
-- becomes 65 against 35, a difference a reader can see -- at the cost of clamping both ends:
-- Switzerland at 27.4% and a hypothetical 34% would both score 100. The alternatives offered
-- were 25%-60% (nobody clamps, but most of Europe compresses into a narrow band of scores) and a
-- three-anchor kink at 45%.
--
-- Scores are written on a scale of 100, the shipped `settings.score_scale_max`. An evaluation
-- run on a different scale refuses these anchors rather than rescaling them silently
-- (`Criterion.refuse_unless_its_anchors_fit`, known-issues D25). Provisional, like every
-- threshold in this project.
-- depends: 0446-cheap-but-taxed-judges-the-total-rate

INSERT INTO criterion_scale_anchor (criterion, input_value, score)
SELECT c.id, anchor.input_value, anchor.score
FROM   criterion AS c
CROSS  JOIN (VALUES (35, 100), (55, 0)) AS anchor (input_value, score)
WHERE  c.criteria_set = 'local_employment'
  AND  c.attribute = 'country.total_tax_rate_effective'
ON CONFLICT (criterion, input_value) DO UPDATE SET score = EXCLUDED.score;
