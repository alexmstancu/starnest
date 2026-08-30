-- Remove the seeded rules. A recorded match_rule_result holds its rule by a foreign key, so a
-- gate that has been judged for a candidate cannot be removed by accident.

DELETE FROM compound_rule_input WHERE compound_rule IN ('mild_now_brutal_later', 'cheap_but_taxed');
DELETE FROM compound_rule       WHERE id IN ('mild_now_brutal_later', 'cheap_but_taxed');
DELETE FROM match_rule          WHERE id IN ('eu_free_movement', 'uk_skilled_worker', 'ch_eu_efta_quota', 'not_manually_excluded');
