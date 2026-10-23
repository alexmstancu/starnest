-- Drop the per-run item table, returning a run's item count to the rectangle of its two scope
-- lists. Touches `data_acquisition_run_item`, the table the forward step created.
--
-- **This rollback refuses once a run has recorded pairs that are not its full rectangle, and
-- that is the point (FU-A5).** A sweep's items are exactly its candidate list crossed with its
-- attribute list, so dropping the table loses nothing a sweep -- the two list tables stay, and
-- the rectangle rebuilds from them. A *retry* or *ask-again* records only the pairs it asked
-- about, a strict subset of that rectangle; those corners cannot be rebuilt from the lists,
-- which name candidates and attributes a retry never crossed. So a rollback here would silently
-- lose which pairs a past retry asked, and bring back the phantom `unanswered` corners BE-11
-- removed -- items nobody asked about that asking again can never close.
--
-- **Locked before it counts** (FU-A5, following 0478/0503). The count reads the item table and
-- the two list tables; a retry's run committed between the read and the drop would escape the
-- refusal and be dropped with the rest. SHARE ROW EXCLUSIVE waits for a write in flight and
-- holds off new ones until this commits, while reads go on.
LOCK TABLE data_acquisition_run_item, data_acquisition_run_candidate,
           data_acquisition_run_attribute IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    scoped integer;
BEGIN
    SELECT count(*) INTO scoped
    FROM (
        SELECT i.data_acquisition_run
        FROM   data_acquisition_run_item AS i
        GROUP  BY i.data_acquisition_run
        HAVING count(*) <> (
            SELECT count(DISTINCT c.candidate) * count(DISTINCT a.attribute)
            FROM   data_acquisition_run_candidate AS c
            JOIN   data_acquisition_run_attribute AS a
                   ON a.data_acquisition_run = c.data_acquisition_run
            WHERE  c.data_acquisition_run = i.data_acquisition_run
        )
    ) AS runs_scoped_to_pairs;

    IF scoped > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0506: % run(s) recorded the exact pairs they asked about rather '
            'than the full rectangle -- a retry or ask-again -- and this drops the table that '
            'holds them. Those pairs cannot be rebuilt from the candidate and attribute lists, '
            'which name corners no source was asked about. Restore from the backup make migrate '
            'took instead of forcing this.', scoped;
    END IF;
END $$;

-- Below here only runs on a database whose every run is a full rectangle -- which includes every
-- fresh one and the test database, so the drop path is still exercised.
DROP TABLE IF EXISTS data_acquisition_run_item;
