-- `mild_now_brutal_later` meets the figures: both bands decided, and the rule applied.
--
-- The rule shipped with both condition thresholds NULL (reqs.md 7.4: "both bands TBD, meant to
-- meet real figures first"), so it was defined but fired for nobody. The figures now exist --
-- avg_annual_temperature from Open-Meteo, and projected_summer_heat_days from Copernicus (the
-- nine-model EURO-CORDEX ensemble, the adapter reworked for NetCDF in c21af66). So the bands are
-- chosen against the real joint distribution with the household (2026-10-09), not invented.
--
-- **Mild now: 10 C <= avg_annual_temperature <= 16 C.** A temperate annual mean -- above the cold
-- Nordic band (Iceland 5.7, Sweden 8.7) and below the already-warm Mediterranean (Italy 16.5,
-- Spain 17.1, Greece 18.5, Cyprus 20.8). A place that feels comfortable today.
--
-- **Brutal later: projected_summer_heat_days >= 25.** A month or so of days above 30 C by
-- 2041-2070; no upper bound, because there is no "too hot to warn".
--
-- Together (AllConditionsHold) they warn the temperate-now / hot-later band: **Hungary (12.4 C,
-- 36 days), Romania (12.6 C, 31), Bulgaria (12.8 C, 37) and Croatia (13.4 C, 28)**. The
-- Mediterranean has more projected heat but is excluded by design -- it is already hot, so there
-- is no hidden change to warn about. It is a warning, never a rule-out (reqs.md 5.5).
--
-- Applied on the shipped set: criteria_set_compound_rule.is_applied flips to true for
-- local_employment, so the warning reaches the ranking -- it shows for a candidate once that
-- candidate has a stored projected_summer_heat_days figure (the next `make acquire` lands them).
-- depends: 0495-projected-heat-is-scored-by-standing

UPDATE compound_rule_condition
SET    threshold_min = 10, threshold_max = 16
WHERE  compound_rule = 'mild_now_brutal_later'
  AND  attribute = 'country.avg_annual_temperature';

UPDATE compound_rule_condition
SET    threshold_min = 25, threshold_max = NULL
WHERE  compound_rule = 'mild_now_brutal_later'
  AND  attribute = 'country.projected_summer_heat_days';

UPDATE criteria_set_compound_rule
SET    is_applied = true
WHERE  criteria_set = 'local_employment'
  AND  compound_rule = 'mild_now_brutal_later';

-- Refuse rather than seed a half-configured rule: all three rows must have taken the change, so
-- a typo in an attribute id or set id fails here instead of leaving the rule quietly inert.
DO $$
DECLARE
    temp_band  integer;
    heat_floor integer;
    applied    integer;
BEGIN
    SELECT count(*) INTO temp_band FROM compound_rule_condition
    WHERE compound_rule = 'mild_now_brutal_later'
      AND attribute = 'country.avg_annual_temperature'
      AND threshold_min = 10 AND threshold_max = 16;
    SELECT count(*) INTO heat_floor FROM compound_rule_condition
    WHERE compound_rule = 'mild_now_brutal_later'
      AND attribute = 'country.projected_summer_heat_days'
      AND threshold_min = 25 AND threshold_max IS NULL;
    SELECT count(*) INTO applied FROM criteria_set_compound_rule
    WHERE criteria_set = 'local_employment' AND compound_rule = 'mild_now_brutal_later'
      AND is_applied;
    IF temp_band <> 1 OR heat_floor <> 1 OR applied <> 1 THEN
        RAISE EXCEPTION
            'mild_now_brutal_later not fully configured: temp_band=% heat_floor=% applied=%',
            temp_band, heat_floor, applied;
    END IF;
END $$;
