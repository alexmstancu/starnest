-- Catalog: the household numbers a compound rule may read (reqs.md 3.7a).
--
-- household_field has been an empty controlled vocabulary since 0001, and an empty vocabulary
-- behind a foreign key does not restrict a shape, it abolishes it: every
-- compound_rule_input naming a field was refused, so ShareOfHouseholdField -- one of the three
-- shapes of 3.7a -- could name nothing and no rule of that shape could ever be seeded.
--
-- Three ids, and they are the three monetary fields of the household record. A share is a money
-- figure measured against a money figure: rent against target spend, cost of living against net
-- income (reqs.md 7.4). The household's person counts are deliberately absent -- rent as a share
-- of "two adults" is not a quantity, and a vocabulary that offered one would let a rule ask for
-- it and get an answer that looks like a number.
--
-- The ids match the field names on the household record exactly. Something must eventually
-- resolve one to the other -- that resolution belongs to evaluation/, where the objective and
-- subjective halves are allowed to meet -- and two spellings of the same three fields would be
-- a place for them to drift.
-- depends: 0104-catalog-default-criteria-set

INSERT INTO household_field (id) VALUES
    ('net_income'),
    ('target_monthly_spend'),
    ('max_rent')
ON CONFLICT (id) DO NOTHING;
