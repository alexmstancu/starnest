-- Remove the household field vocabulary.
--
-- A plain delete, never a cascade: a foreign key from a rule that reads one of these fields is
-- exactly what should make this fail rather than quietly unhook the rule from what it measures
-- against (arch.md 7.4).

DELETE FROM household_field WHERE id IN ('net_income', 'target_monthly_spend', 'max_rent');
