DELETE FROM criterion
WHERE  criteria_set = 'minimal'
  AND  attribute IN ('country.average_working_hours', 'country.rail_network_density',
                     'country.road_network_quality');
UPDATE criterion SET weight = 100 WHERE criteria_set = 'minimal' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 100 WHERE criteria_set = 'minimal' AND attribute = 'country.broadband_coverage';
