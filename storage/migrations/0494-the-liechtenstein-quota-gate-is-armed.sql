-- Arm `li_eea_quota` on the `local_employment` set, for parity with `ch_eu_efta_quota`.
--
-- `0493` declared the gate; this enforces it on the shipped set. **Without this it was inert in a
-- way its sibling is not**: `0104` arms `eu_free_movement`, `uk_skilled_worker` and
-- `ch_eu_efta_quota` on `local_employment`, so answering Switzerland's quota gate `not_matching`
-- makes Switzerland not match -- but answering Liechtenstein's did nothing, because no set had
-- armed it. Liechtenstein's quota is the exact analog of Switzerland's (a per-country permit
-- draw), so it belongs in the same armed-but-unanswered baseline.
--
-- **This changes no ranking.** A gate fires only when it is both enforced *and* answered, and
-- `li_eea_quota` is answered for no candidate (as none of the three existing gates are either).
-- It arms the gate so that a future answer bites, nothing more.
--
-- **Only `local_employment`.** `remote_only` (`0469`) arms no gate at all, so parity there is
-- already held -- `ch_eu_efta_quota` is unarmed on `remote_only` too, and so is this.
-- depends: 0493-liechtensteins-quota-is-a-gate

INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced) VALUES
    ('local_employment', 'li_eea_quota', true)
ON CONFLICT (criteria_set, match_rule) DO UPDATE SET is_enforced = EXCLUDED.is_enforced;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM criteria_set_match_rule
        WHERE criteria_set = 'local_employment' AND match_rule = 'li_eea_quota' AND is_enforced
    ) THEN
        RAISE EXCEPTION 'li_eea_quota was not armed on local_employment';
    END IF;
END $$;
