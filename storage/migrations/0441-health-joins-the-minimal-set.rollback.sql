-- **Refuses rather than overwrite weights a person changed** (TL-N6, D70). The weights below are
-- written as literals, which are right only while the pillar weights of the minimal set stand
-- exactly as 0441 left them: an edit or a lock since then would be overwritten without anyone
-- choosing to, and the pillar would no longer sum to 100. So this compares them set by set and
-- names every set that moved. A set that no longer exists is passed over, as is every set 0441
-- never touched (TL-N5).
--
-- **Locked before it compares** (BE-A1): an edit committed between the comparison and the overwrite
-- would escape it. SHARE ROW EXCLUSIVE waits for a write in flight and holds off new ones until
-- this commits, while reads go on.
LOCK TABLE pillar_weight IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    changed text;
BEGIN
    SELECT string_agg(DISTINCT 'minimal', ', ')
    INTO   changed
    FROM   (SELECT pillar, weight, weight_locked
            FROM   pillar_weight WHERE criteria_set = 'minimal') AS judged
    FULL JOIN (VALUES
               ('career', 13),
               ('connectivity', 10),
               ('culture', 12),
               ('governance', 20),
               ('health', 15),
               ('housing', 18),
               ('safety', 12)
           ) AS left_by (pillar, weight)
           ON  left_by.pillar = judged.pillar
    WHERE  (coalesce(judged.weight <> left_by.weight, true) OR judged.weight_locked)
      AND  EXISTS (SELECT 1 FROM pillar_weight AS kept WHERE kept.criteria_set = 'minimal');
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot roll back 0441: the pillar weights it set were changed or locked since in '
            'criteria set(s) (%), and this would overwrite them with the weights before it. Set '
            'them back as 0441 left them and roll back again, or restore from the backup make '
            'migrate took.', changed;
    END IF;
END $$;

DELETE FROM criterion
WHERE criteria_set = 'minimal' AND attribute = 'country.healthcare_system_quality';

DELETE FROM pillar_weight WHERE criteria_set = 'minimal' AND pillar = 'health';

UPDATE pillar_weight SET weight = 20 WHERE criteria_set = 'minimal' AND pillar = 'housing';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'culture';
UPDATE pillar_weight SET weight = 25 WHERE criteria_set = 'minimal' AND pillar = 'governance';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'safety';
UPDATE pillar_weight SET weight = 15 WHERE criteria_set = 'minimal' AND pillar = 'career';
