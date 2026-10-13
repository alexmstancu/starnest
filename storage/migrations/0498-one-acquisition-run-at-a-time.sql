-- At most one acquisition run is `running` at once (reqs.md 10, ST-01).
--
-- `run_in_flight()` followed by an INSERT is check-then-act: two concurrent POST
-- /data-acquisition-runs -- two tabs, a double-submit, a timeout-and-retry -- can both pass the
-- read, open two running runs, and each then spend. The API's guard narrows the window but
-- cannot close it, because the check and the insert are two statements.
--
-- A partial unique index makes the guarantee the database's rather than the read's: every
-- `running` row carries the same indexed value, so a second one violates the index. The store
-- turns that violation into the same RunAlreadyInFlightError the check raises, so the race's
-- loser gets the 409 it would have got anyway rather than a 500. A finished run leaves the
-- index (its status is no longer `running`), freeing the slot.
--
-- depends: 0497-anchor-sunshine-and-air-connectivity
CREATE UNIQUE INDEX one_acquisition_run_at_a_time
    ON data_acquisition_run (run_status)
    WHERE run_status = 'running';
