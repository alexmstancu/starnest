-- Back to a criterion that cannot place the 32 figures stored against it.
UPDATE criterion SET normalisation_method = 'fixed'
WHERE  attribute = 'country.forest_cover';
