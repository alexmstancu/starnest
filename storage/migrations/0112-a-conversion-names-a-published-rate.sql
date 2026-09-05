-- A converted amount names a rate somebody published, not a number that arrived with it.
--
-- `value_monetary` stored `fx_rate` and `fx_rate_date` as loose scalars: positive, dated, and
-- otherwise unaccountable. Nothing tied them to the `fx_rate` table, which has a publishing
-- source on every row and which had zero rows and no readers. So two values could carry
-- DIFFERENT rates for the same pair on the same day -- the precise failure reqs.md 5.5 names
-- when it says the rate must carry its source, and the one openapi.yaml's `FxRate` already
-- requires a `data_source` for (known-issues D1).
--
-- H3 made the rate explain the EUR figure: `amount * fx_rate` must produce `amount_eur`. That
-- catches an unconverted amount, and it cannot catch a rate that is internally consistent and
-- simply wrong -- 0.18 for RON/EUR on a day the ECB published 0.201. Only the published rate
-- can catch that, so the rate has to be a row rather than a number.
--
-- The pair is (the value's own currency, EUR). EUR appears in the schema here because
-- `amount_eur` is a column name: the schema is already committed to one quote currency, and
-- `data/fx.py` says so in as many words -- "not a preference and not a default". A generated
-- column states that commitment where a foreign key can use it, rather than leaving it implied
-- by a column's name.
--
-- Generated rather than passed in, so nothing in the insert path or the domain model changes
-- and no caller can name a currency the EUR column does not hold.
-- depends: 0111-attribute-max-age

-- The ECB publishes the euro reference rates on working days. It is a source like any other
-- (reqs.md 3.5) and ranks with the official international bodies.
INSERT INTO data_source (id, name, source_kind, default_priority, reliability_tier) VALUES
    ('ecb', 'European Central Bank', 'structured', 16, 'official_international')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Referenceable, so a stored conversion can be pinned to the published figure. The primary key
-- is already (base, quote, rate_date), so adding `rate` restricts nothing; it exists to be the
-- target of the key below, which is what makes the rate on the value the published one rather
-- than merely a number of the right shape.
ALTER TABLE fx_rate
    ADD CONSTRAINT fx_rate_published_key UNIQUE (base_currency, quote_currency, rate_date, rate);

ALTER TABLE value_monetary
    ADD COLUMN fx_quote_currency text
        GENERATED ALWAYS AS (CASE WHEN fx_rate IS NULL THEN NULL ELSE 'EUR' END) STORED;

ALTER TABLE value_monetary
    ADD CONSTRAINT value_monetary_quote_currency_exists
        FOREIGN KEY (fx_quote_currency) REFERENCES currency (id);

-- MATCH SIMPLE, and deliberately: a figure already in EUR has all four columns NULL, the check
-- is skipped, and nothing demands a rate for a conversion that never happened.
ALTER TABLE value_monetary
    ADD CONSTRAINT value_monetary_rate_is_one_that_was_published
        FOREIGN KEY (currency, fx_quote_currency, fx_rate_date, fx_rate)
            REFERENCES fx_rate (base_currency, quote_currency, rate_date, rate);

COMMENT ON COLUMN value_monetary.fx_quote_currency IS
    'Always EUR when a rate is recorded, and NULL otherwise. Generated, so that the currency amount_eur is denominated in can be named by a foreign key (reqs.md 5.5).';
