-- Logins are deactivated, never removed.
--
-- `DELETE /users/:id` was a hard delete. Every domain records who did something as a *username
-- string* — recordedBy, movedBy, auditedBy, createdBy — rather than as a foreign key, so dropping
-- the row left those records intact and therefore looked harmless. It was not: it destroyed the
-- only description of the person behind the name, and it released the username for reissue. Once
-- reissued, two different people share one identity in the audit trail with nothing to tell them
-- apart, and the trail is the reason those columns exist.
--
-- The `unique` on `username` is therefore left covering deactivated rows, so a departed operator's
-- username stays reserved permanently. Reissuing it is the failure being prevented, not a feature
-- being withheld.
--
-- Nullable with no backfill: every existing row is active, which is what null already means.

ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;
