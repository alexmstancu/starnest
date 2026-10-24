-- Undo 0508: drop the two indexes and the two columns it added.
--
-- **Refused while any set is deleted.** Dropping `deleted_at` would bring each deleted set back
-- as a live one without a word, perhaps under a name another set has taken since. Restore or
-- purge them first, or restore from the backup make migrate took.
--
-- **Locked before it counts** (FU-A5, as 0503 and 0507): a deletion committed between the count
-- and the drop would escape the refusal.
LOCK TABLE criteria_set IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    deleted integer;
    named   text;
BEGIN
    SELECT count(*), string_agg(id, ', ' ORDER BY id)
    INTO   deleted, named
    FROM   criteria_set
    WHERE  deleted_at IS NOT NULL;

    IF deleted > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0508: % criteria set(s) are deleted (%), and dropping deleted_at '
            'would bring each back as a live set without a word. Restore or purge them first, or '
            'restore from the backup make migrate took instead of forcing this.', deleted, named;
    END IF;
END $$;

DROP INDEX IF EXISTS criteria_set_one_default;
DROP INDEX IF EXISTS criteria_set_name_is_unique;

ALTER TABLE criteria_set
    DROP COLUMN IF EXISTS is_default,
    DROP COLUMN IF EXISTS deleted_at;
