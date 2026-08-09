-- Wholesale-sell domain rebuild: CREATED→CONFIRMED→PACKED→SHIPPED→PAID plus the failure branches,
-- dual purity pricing, contested-weight capture and the confirm-sweep deadline. Mirrors the
-- wholesale-buy rebuild in 0006.
--
-- Hand-hardened the same way so it also applies to a populated table: the legacy statuses are
-- remapped while the column is plain text, and the new NOT NULL columns are added nullable,
-- backfilled, then constrained.

ALTER TABLE "whole_sell_statuses" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "current_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "current_status" SET DEFAULT 'CREATED'::text;--> statement-breakpoint

-- legacy status remap, done while both columns are plain text:
--   DRAFT   → CREATED  the pre-confirmation state, now editable and swept by confirm-all
--   SETTLED → PAID     the old terminal state — the money had landed by then
-- SHIPPED and CANCELLED keep their names. SHIPPED also keeps its meaning for inventory purposes:
-- the old model decremented on entering it, and in the new model anything at SHIPPED has already
-- been decremented (at PACKED), so no balance correction is needed. Legacy rows simply have no
-- PACKED entry in their status log, which is an accurate record of what the old system captured.
UPDATE "whole_sell_statuses" SET "status" = 'CREATED' WHERE "status" = 'DRAFT';--> statement-breakpoint
UPDATE "whole_sell_statuses" SET "status" = 'PAID' WHERE "status" = 'SETTLED';--> statement-breakpoint
UPDATE "whole_sell_transactions" SET "current_status" = 'CREATED' WHERE "current_status" = 'DRAFT';--> statement-breakpoint
UPDATE "whole_sell_transactions" SET "current_status" = 'PAID' WHERE "current_status" = 'SETTLED';--> statement-breakpoint

DROP TYPE "public"."whole_sell_status";--> statement-breakpoint
CREATE TYPE "public"."whole_sell_status" AS ENUM('CREATED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'PAID', 'DISPUTED', 'PAYMENT_FAILED', 'CANCELLED', 'REJECTED', 'RETURNED', 'WRITTEN_OFF');--> statement-breakpoint
ALTER TABLE "whole_sell_statuses" ALTER COLUMN "status" SET DATA TYPE "public"."whole_sell_status" USING "status"::"public"."whole_sell_status";--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "current_status" SET DEFAULT 'CREATED'::"public"."whole_sell_status";--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "current_status" SET DATA TYPE "public"."whole_sell_status" USING "current_status"::"public"."whole_sell_status";--> statement-breakpoint

-- price_per_gb keeps its name and its meaning: the 96.5% quote. The 99.9% quote is derived from
-- it by the purity ratio for any pre-existing row; from here on the server derives it on write.
ALTER TABLE "whole_sell_transactions" ADD COLUMN "price_per_gb_999" numeric;--> statement-breakpoint
UPDATE "whole_sell_transactions" SET "price_per_gb_999" = "price_per_gb" * (99.9 / 96.5) WHERE "price_per_gb_999" IS NULL;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "price_per_gb_999" SET NOT NULL;--> statement-breakpoint

-- the weight the buyer contests — null until a shipped deal is disputed
ALTER TABLE "whole_sell_transactions" ADD COLUMN "actual_weight_gb" numeric;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD COLUMN "actual_weight_gm" numeric;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD COLUMN "actual_amount" numeric;--> statement-breakpoint

-- confirm-sweep deadline; pre-existing rows are past theirs by definition
ALTER TABLE "whole_sell_transactions" ADD COLUMN "confirm_due_at" timestamp;--> statement-breakpoint
UPDATE "whole_sell_transactions" SET "confirm_due_at" = "recorded_at" WHERE "confirm_due_at" IS NULL;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "confirm_due_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "whole_sell_transactions" ADD COLUMN "notes" text;
