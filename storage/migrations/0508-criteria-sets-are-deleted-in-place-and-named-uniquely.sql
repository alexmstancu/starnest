-- A criteria set is deleted in place, its name is its own among live sets, and one set is the
-- default (PL-033, PL-035, PL-036, PL-034; decisions P1-27 to P1-29 and P1-35).
--
-- depends: 0507-freeze-the-rest-of-what-a-ranking-was-computed-with
--
-- **Deleting a set keeps every row it owns** (P1-27). It was one multi-table DELETE with no way
-- back (UF-025), refused for any set a saved ranking used (UF-031). Now it sets `deleted_at` and
-- nothing else, so a restore clears one column and is exact by construction, and a saved ranking
-- keeps naming the row. A deleted set keeps its id, never given to another set (P1-28).
--
-- **A name belongs to one live set** (PL-036), ignoring case and surrounding spaces. A deleted set
-- holds no name; restoring it once another set took the name is refused (P1-35). **One set is the
-- default** (P1-29), the one a new set copies: a flag on the row, kept when the set is deleted.
--
-- **Locked before it counts** (FU-A5). Two live sets sharing a name would fail the index with a
-- driver error naming neither, so the check names them first, under a lock that holds off a set
-- created or renamed between the check and the index.
LOCK TABLE criteria_set IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    clashes text;
BEGIN
    SELECT string_agg(format('%s (%s)', clash.names, clash.ids), '; ' ORDER BY clash.ids)
    INTO   clashes
    FROM   (SELECT string_agg(quote_literal(name), ', ' ORDER BY id) AS names,
                   string_agg(id, ', ' ORDER BY id) AS ids
            FROM   criteria_set
            GROUP  BY lower(btrim(name))
            HAVING count(*) > 1) AS clash;

    IF clashes IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0508: these criteria sets share a name, ignoring case and surrounding '
            'spaces: %. Rename one of each in Configure, stage 1, and migrate again.', clashes;
    END IF;
END $$;

ALTER TABLE criteria_set
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN criteria_set.deleted_at IS
    'When the set was deleted, NULL while it is live. A deleted set keeps every row it owns, so restoring it clears this and nothing else (PL-033).';
COMMENT ON COLUMN criteria_set.is_default IS
    'The set a new one copies (P1-29). At most one, live or deleted.';

-- The same expression the check above groups by, so what it names is what this refuses.
CREATE UNIQUE INDEX criteria_set_name_is_unique
    ON criteria_set (lower(btrim(name)))
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX criteria_set_one_default
    ON criteria_set (is_default)
    WHERE is_default;

UPDATE criteria_set SET is_default = true WHERE id = 'local_employment';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM criteria_set WHERE is_default) THEN
        RAISE NOTICE '0508: no criteria set is called local_employment, so no set is the '
            'default and a new set has nothing to copy until one is made the default.';
    END IF;
END $$;
