-- Disarm `li_eea_quota` on `local_employment`, leaving the gate declared (that is `0493`'s to
-- undo). Removing the enforcement row here is also what keeps the ordered rollback FK-safe: once
-- this has run, `criteria_set_match_rule` no longer references `li_eea_quota`, so `0493`'s own
-- rollback can delete the `match_rule` row without hitting the foreign key.
--
-- An answer recorded against the gate (`match_rule_result`) is not touched: disarming a gate is
-- not the same as discarding the judgement of how a candidate stands against it. `0493`'s
-- rollback is the one that guards those.

DELETE FROM criteria_set_match_rule
WHERE  criteria_set = 'local_employment' AND match_rule = 'li_eea_quota';
