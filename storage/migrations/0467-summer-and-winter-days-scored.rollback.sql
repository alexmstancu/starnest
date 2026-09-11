DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE criteria_set = 'local_employment'
                     AND attribute = 'country.winter_daytime_temperature');
DELETE FROM criterion
WHERE  criteria_set = 'local_employment'
  AND  attribute IN ('country.summer_daytime_temperature', 'country.winter_daytime_temperature');
UPDATE criterion SET weight = 25 WHERE criteria_set = 'local_employment' AND attribute = 'country.avg_annual_temperature';
UPDATE criterion SET weight = 25 WHERE criteria_set = 'local_employment' AND attribute = 'country.annual_sunshine_hours';
UPDATE criterion SET weight = 20 WHERE criteria_set = 'local_employment' AND attribute = 'country.projected_summer_heat_days';
UPDATE criterion SET weight = 30 WHERE criteria_set = 'local_employment' AND attribute = 'country.climate_zone';
