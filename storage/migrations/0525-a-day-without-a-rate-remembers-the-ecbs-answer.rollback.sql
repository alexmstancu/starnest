-- Undo 0525: a day without a rate of its own is asked of the ECB again each time.
--
-- Loses nothing that cannot be had back: every row is what the ECB answers when asked again,
-- and the rates the rows point at stay on `fx_rate`.

DROP TABLE IF EXISTS fx_rate_answer;
