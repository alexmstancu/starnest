-- Undo 0521: a converted amount names its rate and day again, and not who published it.
--
-- Loses nothing: the publisher stays on the `fx_rate` row `0112`'s key names. `0112`'s foreign
-- key comes back under its own name, because `0112`'s rollback drops it by that name. Locked
-- first for the same reason 0521 is.

LOCK TABLE value_monetary, fx_rate IN ACCESS EXCLUSIVE MODE;

ALTER TABLE value_monetary
    DROP CONSTRAINT IF EXISTS value_monetary_rate_is_one_its_publisher_published,
    DROP CONSTRAINT IF EXISTS value_monetary_rate_names_its_publisher,
    ADD CONSTRAINT value_monetary_rate_is_one_that_was_published
        FOREIGN KEY (currency, fx_quote_currency, fx_rate_date, fx_rate)
            REFERENCES fx_rate (base_currency, quote_currency, rate_date, rate);

ALTER TABLE value_monetary DROP COLUMN IF EXISTS fx_rate_source;

ALTER TABLE fx_rate DROP CONSTRAINT IF EXISTS fx_rate_published_by_key;
