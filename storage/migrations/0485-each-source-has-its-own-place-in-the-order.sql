-- Two sources claimed priority 16, so the order between them was whatever the plan returned.
--
-- `ecb` and `unodc` have shipped on the same number since the catalog was seeded.
-- `select_data_sources` ordered by priority alone, so the source-priority panel could show
-- them either way round between two reads, and `active_value` fell through to its later terms
-- for any attribute they both answered. They answer different attributes -- currency rates and
-- homicide -- so nothing was ever scored wrongly, which is why it sat unnoticed: the fault was
-- in the catalog rather than in anything it produced.
--
-- **`attribute_source_priority` has `UNIQUE (attribute, rank)`.** The per-attribute override is
-- forced unique and the global order it overrides was not, which is the asymmetry this closes.
--
-- Everything from `unodc` upward shifts by one rather than `unodc` moving to the end of the
-- block: the sequence states a preference between publishers, and appending it after
-- Eurobarometer would answer the tie by demoting it. The relative order is unchanged.
-- depends: 0484-pillars-read-as-one-word-in-their-own-order

UPDATE data_source SET default_priority = 26 WHERE id = 'eurobarometer';
UPDATE data_source SET default_priority = 25 WHERE id = 'koeppen';
UPDATE data_source SET default_priority = 24 WHERE id = 'natural_earth';
UPDATE data_source SET default_priority = 23 WHERE id = 'protected_planet';
UPDATE data_source SET default_priority = 22 WHERE id = 'copernicus';
UPDATE data_source SET default_priority = 21 WHERE id = 'open_meteo';
UPDATE data_source SET default_priority = 20 WHERE id = 'unesco';
UPDATE data_source SET default_priority = 19 WHERE id = 'fao';
UPDATE data_source SET default_priority = 18 WHERE id = 'ilo';
UPDATE data_source SET default_priority = 17 WHERE id = 'unodc';

-- **No UNIQUE constraint, deliberately.** It is the obvious next step and it is wrong here:
-- `update_data_source` exists so a household can set where a source stands, and with a unique
-- index every reorder that passes through a number somebody else holds is refused -- which is
-- every reorder, since moving a source one place means briefly sharing the place it moves to.
-- Enforcing uniqueness needs a reordering protocol that shifts the others, which is a feature
-- rather than a repair. What guards the catalog instead is a test
-- (`test_no_two_sources_claim_the_same_priority`), and what guards a tie made at runtime is
-- the `ORDER BY ..., s.id` that `select_data_sources` now carries.
