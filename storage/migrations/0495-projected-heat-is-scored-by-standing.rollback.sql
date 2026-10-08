-- Back to `fixed`. This restores the silent-zero behaviour described in the forward migration,
-- so it is only safe while no Copernicus figure is stored -- but it is a pure normalisation-method
-- change with no data to lose either way, so it is not guarded.

UPDATE criterion
SET    normalisation_method = 'fixed'
WHERE  attribute = 'country.projected_summer_heat_days'
  AND  normalisation_method = 'percentile';
