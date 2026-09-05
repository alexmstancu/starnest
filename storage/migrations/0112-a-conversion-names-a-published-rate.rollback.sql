-- Let a conversion carry a rate nobody published again.
--
-- The ECB row stays: it is a data source like any other, values may already reference it, and
-- removing a source that a stored value names is not something a rollback may do (arch.md 7.4).

ALTER TABLE value_monetary DROP CONSTRAINT value_monetary_rate_is_one_that_was_published;
ALTER TABLE value_monetary DROP CONSTRAINT value_monetary_quote_currency_exists;
ALTER TABLE value_monetary DROP COLUMN fx_quote_currency;

ALTER TABLE fx_rate DROP CONSTRAINT fx_rate_published_key;
