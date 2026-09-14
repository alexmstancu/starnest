-- Un-reject exactly the rows `0473` rejected, matched on its own reason so a rejection made for
-- any other cause is left alone.

UPDATE value
SET    rejection_reason = NULL
WHERE  data_source = 'llm'
  AND  rejection_reason LIKE 'Dated as the day it was fetched rather than the period it describes%';
