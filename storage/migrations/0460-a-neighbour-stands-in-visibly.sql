-- Where no source covers a candidate, another candidate's figure may stand in -- under its own
-- source, at low confidence, and never as a measurement of the place it stands in for.
-- Decided at Gate B (devplan.md, reqs.md Q195); built 2026-09-11 (Q208).
--
-- **Why it exists.** Three of the six blocking attributes come from sources that cover 31 of
-- the 32 countries, and Liechtenstein is the one each time: Eurostat does not survey its prices,
-- OECD Taxing Wages does not model its tax system, and it is not a WHO member state. That is not
-- a broken fetch, so Gate B would fail for a true reason. It sits in a customs and currency union
-- with Switzerland, so Switzerland's figure is the least-bad answer -- and an answer that says it
-- is Switzerland's.
--
-- **Declared per attribute, not per country.** Switzerland's price level is a fair guide to
-- Liechtenstein's; Switzerland's homicide rate or protected-land share is not, because those
-- are facts about a different territory. Each row is a claim that one specific figure transfers,
-- with the reason on the row, so nothing stands in by default.
--
-- **Its own source, ranked below every real measurement.** A figure from the substitute is
-- stored with `data_source = 'stand_in'`, not with the substitute's publisher: stored as OECD's,
-- it would rank as OECD and read as OECD having measured Liechtenstein. At 75 it sits below
-- every official, national, research and crowdsourced source and below `derived`, so the day any
-- source publishes Liechtenstein's own figure, that figure wins without anybody deleting the
-- stand-in. The quote on each value names the substitute and the publisher it came from.
-- depends: 0449-an-estimated-tax-rate-where-oecd-is-silent

INSERT INTO data_source (id, name, source_kind, default_priority, reliability_tier)
VALUES ('stand_in', 'Another country''s figure, standing in', 'structured', 75, 'derived')
ON CONFLICT (id) DO NOTHING;

-- The attribute key the composite foreign key below needs, in the idiom candidate_level_key
-- already uses: a stand-in may only borrow within one level.
ALTER TABLE attribute ADD CONSTRAINT attribute_level_key UNIQUE (id, level);

CREATE TABLE stand_in (
    candidate            text NOT NULL,
    attribute            text NOT NULL,
    substitute_candidate text NOT NULL,
    level                text NOT NULL REFERENCES level (id),
    reason               text NOT NULL,

    CONSTRAINT stand_in_pkey PRIMARY KEY (candidate, attribute),
    -- All three at one level. A city standing in for a country, or a city attribute borrowed
    -- for a country, is a category error the schema can refuse outright.
    CONSTRAINT stand_in_candidate_is_at_its_level
        FOREIGN KEY (candidate, level) REFERENCES candidate (id, level),
    CONSTRAINT stand_in_substitute_is_at_the_same_level
        FOREIGN KEY (substitute_candidate, level) REFERENCES candidate (id, level),
    CONSTRAINT stand_in_attribute_is_at_the_same_level
        FOREIGN KEY (attribute, level) REFERENCES attribute (id, level),
    CONSTRAINT stand_in_is_another_candidate CHECK (substitute_candidate <> candidate),
    -- The reason is what the screen shows beside the number. A stand-in nobody can justify is
    -- the fabrication this table exists to make visible.
    CONSTRAINT stand_in_says_why CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE stand_in IS
    'Where no source covers a candidate, whose figure stands in for one attribute, and why. The figure is stored under data_source stand_in at low confidence, never as the candidate''s own measurement (reqs.md Q195, Q208).';

INSERT INTO stand_in (candidate, attribute, substitute_candidate, level, reason) VALUES
    ('country.liechtenstein', 'country.cost_of_living_index', 'country.switzerland', 'country',
     'Eurostat does not survey Liechtenstein''s prices. It shares a customs and currency union with Switzerland, and pays Swiss prices for most of what it imports.'),
    ('country.liechtenstein', 'country.total_tax_rate_effective', 'country.switzerland', 'country',
     'OECD Taxing Wages does not model Liechtenstein. Its tax system is its own, with rates of a similar order to the Swiss cantons around it, so this is a rough guide only.'),
    ('country.liechtenstein', 'country.healthcare_system_quality', 'country.switzerland', 'country',
     'Liechtenstein is not a WHO member state, so the Global Health Observatory has no figure for it. Its residents use Swiss hospitals under a bilateral agreement.')
ON CONFLICT (candidate, attribute) DO NOTHING;
