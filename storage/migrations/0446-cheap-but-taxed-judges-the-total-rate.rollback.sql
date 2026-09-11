UPDATE compound_rule_condition
SET    attribute = 'country.income_tax_effective'
WHERE  compound_rule = 'cheap_but_taxed' AND attribute = 'country.total_tax_rate_effective';
