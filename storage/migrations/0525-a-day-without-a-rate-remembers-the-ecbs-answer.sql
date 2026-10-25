-- A day without a reference rate remembers which day's rate the ECB answered it with (PL-170).
--
-- depends: 0524-a-run-records-its-purpose
--
-- The ECB publishes on TARGET working days and answers a weekend or a holiday with the last
-- working day's rate. That rate is recorded under its own day, correctly, so a later conversion
-- for the Saturday found nothing dated Saturday and asked the ECB again, every time. Guessing
-- the day from the rates on record is not safe: a Thursday rate on record does not say whether
-- Friday was a holiday, and only a calendar of TARGET holidays could. So the answer itself is
-- recorded -- "asked for D, the ECB published F" -- and only an answer for D ever answers D.
--
-- **Only a gap is recorded** (F before D): a day with its own rate is answered by `fx_rate`
-- alone. The rate stays on its own day; this table points at it and never copies it.

CREATE TABLE fx_rate_answer (
    base_currency  text NOT NULL,
    quote_currency text NOT NULL,
    asked_for      date NOT NULL,
    rate_date      date NOT NULL,

    CONSTRAINT fx_rate_answer_pkey PRIMARY KEY (base_currency, quote_currency, asked_for),
    CONSTRAINT fx_rate_answer_names_a_recorded_rate
        FOREIGN KEY (base_currency, quote_currency, rate_date)
            REFERENCES fx_rate (base_currency, quote_currency, rate_date),
    CONSTRAINT fx_rate_answer_is_an_earlier_day CHECK (rate_date < asked_for)
);

COMMENT ON TABLE fx_rate_answer IS
    'For a day with no published rate of its own (a weekend, a TARGET holiday), the earlier day whose rate its publisher answered with, so the day is answered from the record rather than asked again (PL-170).';
