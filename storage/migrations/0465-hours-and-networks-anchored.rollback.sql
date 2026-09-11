DELETE FROM criterion_scale_anchor
WHERE  criterion IN (
    SELECT id FROM criterion
    WHERE  criteria_set = 'local_employment'
      AND  attribute IN ('country.average_working_hours', 'country.rail_network_density',
                         'country.road_network_quality')
);
