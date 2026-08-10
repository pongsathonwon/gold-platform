-- Closes the one hole both wholesale domains still had: value that moved with nothing to show
-- for it and no way to record how it ended.
--
-- 1. whole_buy CHECKED → STOCKED
--    The status is renamed for what it does — it is the step that moves gold into inventory, and
--    the old name described the clerical act instead. RENAME VALUE rewrites the label in place,
--    so every existing transaction and status-log row follows it with no data migration.
--
-- 2. whole_buy gains REFUNDED, and RETURNED stops being terminal
--    RETURNED after PAID left the supplier holding our cash with the machine out of moves. It now
--    resolves: REFUNDED (money back), RECEIVED (they re-delivered the correct item), or
--    WRITTEN_OFF (they never made us whole).
--
-- 3. settled_amount on both tables
--    What was actually paid when it differed from total_amount. Null means it matched. Recorded
--    on the move into PAID and never branched on — an accepted variance closes a deal exactly
--    like an exact payment, so it is a figure accounting needs rather than a state anyone works.
--
-- 4. return_reason on both tables
--    Weight, brand or purity disagreeing with the document are three different failures, and
--    supplier reliability is only reportable if the cause is a column rather than prose in a note.
--
-- ALTER TYPE ... ADD VALUE is safe inside a transaction on PostgreSQL 12+ because the new labels
-- are not read by any statement in this migration; RENAME VALUE has no such restriction. Both are
-- guarded so a re-run is a no-op.

ALTER TYPE "public"."whole_buy_status" RENAME VALUE 'CHECKED' TO 'STOCKED';--> statement-breakpoint
ALTER TYPE "public"."whole_buy_status" ADD VALUE IF NOT EXISTS 'REFUNDED' AFTER 'RETURNED';--> statement-breakpoint

CREATE TYPE "public"."whole_buy_return_reason" AS ENUM('WEIGHT', 'BRAND', 'PURITY', 'DAMAGED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."whole_sell_return_reason" AS ENUM('WEIGHT', 'BRAND', 'PURITY', 'DAMAGED', 'OTHER');--> statement-breakpoint

ALTER TABLE "whole_buy_transactions" ADD COLUMN IF NOT EXISTS "settled_amount" numeric;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD COLUMN IF NOT EXISTS "return_reason" "public"."whole_buy_return_reason";--> statement-breakpoint

ALTER TABLE "whole_sell_transactions" ADD COLUMN IF NOT EXISTS "settled_amount" numeric;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD COLUMN IF NOT EXISTS "return_reason" "public"."whole_sell_return_reason";
