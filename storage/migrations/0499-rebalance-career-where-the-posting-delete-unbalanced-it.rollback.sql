-- A corrective data migration has no safe reverse. Restoring a set to the unbalanced weights
-- `0487` left it with would re-break it, and the original per-set weights are not recoverable
-- from here -- rolling back `0487` itself is what restores the pre-repair shape.
--
-- So this is a deliberate no-op that still names `criterion`, the table the forward step wrote:
-- the rollback-hygiene rule is that a reversal must mention every table its migration touched,
-- and the honest reversal here touches nothing while acknowledging the table it would have to.
UPDATE criterion SET weight = weight WHERE false;
