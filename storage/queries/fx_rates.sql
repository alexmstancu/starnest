-- Published exchange rates, one per pair per day (`0001`, `0112`, `0521`), and which earlier
-- day's rate answered a day without one (`0525`).

-- name: select_fx_rate(base_currency, quote_currency, rate_date)^
-- The rate dated that day, or else the one its publisher answered that day with.
SELECT rate.base_currency, rate.quote_currency, rate.rate_date, rate.rate, rate.data_source
FROM   fx_rate AS rate
WHERE  rate.base_currency = :base_currency
  AND  rate.quote_currency = :quote_currency
  AND  rate.rate_date IN (
           :rate_date,
           (SELECT answer.rate_date
            FROM   fx_rate_answer AS answer
            WHERE  answer.base_currency = :base_currency
              AND  answer.quote_currency = :quote_currency
              AND  answer.asked_for = :rate_date))
ORDER  BY rate.rate_date DESC
LIMIT  1;

-- name: insert_fx_rate(base_currency, quote_currency, rate_date, rate, data_source)!
-- A rate already recorded for its pair and day stands: one rate per pair per day.
INSERT INTO fx_rate (base_currency, quote_currency, rate_date, rate, data_source)
VALUES (:base_currency, :quote_currency, :rate_date, :rate, :data_source)
ON CONFLICT (base_currency, quote_currency, rate_date) DO NOTHING;

-- name: insert_fx_rate_answer(base_currency, quote_currency, asked_for, rate_date)!
-- The first answer recorded for a day stands, as the first rate does.
INSERT INTO fx_rate_answer (base_currency, quote_currency, asked_for, rate_date)
VALUES (:base_currency, :quote_currency, :asked_for, :rate_date)
ON CONFLICT (base_currency, quote_currency, asked_for) DO NOTHING;
