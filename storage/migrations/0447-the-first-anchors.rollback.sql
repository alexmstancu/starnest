DELETE FROM criterion_scale_anchor
WHERE  criterion IN (
    SELECT id FROM criterion
    WHERE  criteria_set = 'local_employment' AND attribute = 'country.total_tax_rate_effective'
);
