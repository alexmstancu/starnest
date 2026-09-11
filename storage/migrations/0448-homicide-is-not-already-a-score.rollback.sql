UPDATE criterion
SET    normalisation_method = 'as_is'
WHERE  criteria_set = 'local_employment' AND attribute = 'country.homicide_rate';
