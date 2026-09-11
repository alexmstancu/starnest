DELETE FROM criterion_scale_anchor
WHERE  criterion IN (
    SELECT id FROM criterion
    WHERE  criteria_set = 'local_employment'
      AND  attribute IN ('country.housing_cost_overburden_rate', 'country.tech_employment_share',
                         'country.broadband_coverage', 'country.life_satisfaction',
                         'country.economic_outlook', 'country.overcrowding_rate',
                         'country.protected_land_share')
);
