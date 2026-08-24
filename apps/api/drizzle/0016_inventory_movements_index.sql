-- The movement ledger had no index at all beyond its primary key on `id`, so every read of
-- `GET /inventory/movements` was a sequential scan plus an in-memory sort.
--
-- The column order matches `listMovements` exactly: the window bounds `movement_date`, and
-- `(moved_at, id)` breaks ties inside a day. One index therefore serves both the range scan and
-- the ordering, with no sort step left to do.
--
-- The reason to add it now rather than later is `sumMovementsBefore`, the opening-balance query.
-- It aggregates *everything* before the window's first day, so its cost tracks the age of the
-- ledger and not the size of the request — opening the page on yesterday–today gets slower every
-- month the shop trades. An Excel export invites wider windows on top of that.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: the migrator runs each file inside a transaction,
-- which CONCURRENTLY forbids. The table is small enough today that the brief write lock is not
-- worth splitting this out into an out-of-band step.

CREATE INDEX IF NOT EXISTS "inventory_movements_movement_date_idx"
    ON "inventory_movements" USING btree ("movement_date", "moved_at", "id");
