-- `cheap_but_taxed` judges the total tax rate, now that the income-tax attribute is retired.
--
-- The rule warns when low prices are offset by a tax burden that removes the advantage. `0445`
-- retired `income_tax_effective` and left this condition naming it -- a rule over a retired
-- attribute receives no new figures, so it could never have fired, and would never have said
-- so. Found by reading `reqs.md` by hand; `test_no_rule_judges_a_retired_attribute` now finds it
-- instead.
--
-- The total rate is the better input anyway. "A tax burden that removes the advantage" is about
-- everything taken from the cost of employment, not the employee's share alone -- exactly the
-- distinction Q205 made. The thresholds stay NULL: both bands were TBD and remain so, and the
-- total rate runs on a different range than the old measure, so no old number would carry over
-- honestly.
-- depends: 0445-total-tax-rate-replaces-income-tax

UPDATE compound_rule_condition
SET    attribute = 'country.total_tax_rate_effective'
WHERE  compound_rule = 'cheap_but_taxed' AND attribute = 'country.income_tax_effective';
