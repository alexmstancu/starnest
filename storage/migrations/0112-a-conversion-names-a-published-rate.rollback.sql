-- Let a conversion carry a rate nobody published again.
--
-- The ECB row stays: it is a data source like any other, values may already reference it, and
-- removing a source that a stored value names is not something a rollback may do (arch.md 7.4).

ALTER TABLE value_monetary DROP CONSTRAINT value_monetary_rate_is_one_that_was_published;
ALTER TABLE value_monetary DROP CONSTRAINT value_monetary_quote_currency_exists;
ALTER TABLE value_monetary DROP COLUMN fx_quote_currency;

ALTER TABLE fx_rate DROP CONSTRAINT fx_rate_published_key;

-- The source row this added, removed -- but only if nothing came to depend on it. The ECB is
-- the authority for a monetary conversion's rate (`0112`), and a later migration or a stored
-- value may now name it; deleting a source a value points at would fail on the foreign key,
-- which is the database saying the rollback has gone too far.
DELETE FROM data_source
WHERE  id = 'ecb'
  AND  NOT EXISTS (SELECT 1 FROM value v WHERE v.data_source = 'ecb')
  AND  NOT EXISTS (SELECT 1 FROM attribute_source_priority p WHERE p.data_source = 'ecb');
