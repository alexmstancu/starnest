-- A converted amount names who published its rate (PL-170: ST-18, P10, BE-35; decision D63).
--
-- depends: 0513-a-runs-evidence-is-pinned-to-its-items
--
-- `0112` pinned a conversion to a rate somebody published: the value's (currency, EUR, day,
-- rate) must be a row of `fx_rate`. **The publisher was on that row and nowhere else**, so the
-- contract's `FxRate` -- rate, date and publisher -- could not be served from the value, and
-- the API dropped the rate rather than serve half its provenance (`known-issues.md` P10).
--
-- So the value now carries `fx_rate_source`, together with the rate or not at all, and the key
-- that pins the rate includes it: a conversion claiming a publisher that did not publish the
-- rate is refused by the same foreign key that refuses a rate nobody published. `fx_rate` gains
-- the five-column key that foreign key needs; `0112`'s four-column key stays, because `0112`'s
-- rollback drops it by name.
--
-- **Backfilled through `0112`'s key**, which already names exactly one `fx_rate` row for every
-- converted amount. A converted amount the backfill cannot name a publisher for stops the
-- migration and is named by value -- `0112`'s key makes that impossible, and if it happened
-- anyway, which publisher was meant is not this migration's to decide. No numeric column is
-- added, so `0518`'s finite rule has nothing new to hold.

-- **Locked first, and exclusively** (BE-A1): a conversion written between the backfill and the
-- constraints would meet a raw check violation rather than the refusal below. ACCESS EXCLUSIVE,
-- because both tables are altered, which takes it anyway.
LOCK TABLE value_monetary, fx_rate IN ACCESS EXCLUSIVE MODE;

ALTER TABLE value_monetary ADD COLUMN fx_rate_source text;

UPDATE value_monetary AS converted
SET    fx_rate_source = published.data_source
FROM   fx_rate AS published
WHERE  published.base_currency  = converted.currency
  AND  published.quote_currency = converted.fx_quote_currency
  AND  published.rate_date      = converted.fx_rate_date
  AND  published.rate           = converted.fx_rate;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('value %s (%s on %s at %s)',
                             value_id, currency, fx_rate_date, fx_rate), '; ' ORDER BY value_id)
    INTO   offenders
    FROM   value_monetary
    WHERE  fx_rate IS NOT NULL AND fx_rate_source IS NULL;
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0521: a converted amount names the publisher of its rate, and no '
            'published rate names one for these: %. Record the rate each was converted at in '
            'fx_rate, or delete the figure, then migrate again. Nothing was changed.', offenders;
    END IF;
END $$;

ALTER TABLE fx_rate
    ADD CONSTRAINT fx_rate_published_by_key
        UNIQUE (base_currency, quote_currency, rate_date, rate, data_source);

-- MATCH SIMPLE, as in `0112`: a figure already in EUR has every column NULL and is not checked.
ALTER TABLE value_monetary
    ADD CONSTRAINT value_monetary_rate_names_its_publisher
        CHECK ((fx_rate IS NULL) = (fx_rate_source IS NULL)),
    DROP CONSTRAINT value_monetary_rate_is_one_that_was_published,
    ADD CONSTRAINT value_monetary_rate_is_one_its_publisher_published
        FOREIGN KEY (currency, fx_quote_currency, fx_rate_date, fx_rate, fx_rate_source)
            REFERENCES fx_rate (base_currency, quote_currency, rate_date, rate, data_source);

COMMENT ON COLUMN value_monetary.fx_rate_source IS
    'Who published the rate the amount was converted at -- served with the rate and its date as the contract''s FxRate. Present exactly when the rate is (reqs.md 5.5, ST-18).';
