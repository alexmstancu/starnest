-- Published exchange rates, one per pair per day (`0001`, `0112`, `0521`).

-- name: select_fx_rate(base_currency, quote_currency, rate_date)^
SELECT base_currency, quote_currency, rate_date, rate, data_source
FROM   fx_rate
WHERE  base_currency = :base_currency
  AND  quote_currency = :quote_currency
  AND  rate_date = :rate_date;

-- name: insert_fx_rate(base_currency, quote_currency, rate_date, rate, data_source)!
-- A rate already recorded for its pair and day stands: one rate per pair per day.
INSERT INTO fx_rate (base_currency, quote_currency, rate_date, rate, data_source)
VALUES (:base_currency, :quote_currency, :rate_date, :rate, :data_source)
ON CONFLICT (base_currency, quote_currency, rate_date) DO NOTHING;
