-- The business date every manually-created record now carries, alongside the insert timestamp it
-- already had. Rows written before this migration have only one date to offer, so their business
-- date is backfilled from their own insert timestamp — which is exactly what they meant when the
-- two could not be told apart.
--
-- Generated as a bare `ADD COLUMN ... NOT NULL`, which cannot apply to a table with rows in it.
-- Split into add-nullable → backfill → constrain. The resulting schema is identical, so the
-- drizzle snapshot generated alongside this file still describes it.

ALTER TABLE "inventory_movements" ADD COLUMN "movement_date" date;--> statement-breakpoint
UPDATE "inventory_movements" SET "movement_date" = "moved_at"::date WHERE "movement_date" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "movement_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "stock_gain_adjustments" ADD COLUMN "transaction_date" date;--> statement-breakpoint
UPDATE "stock_gain_adjustments" SET "transaction_date" = "audited_at"::date WHERE "transaction_date" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "transaction_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "stock_loss_adjustments" ADD COLUMN "transaction_date" date;--> statement-breakpoint
UPDATE "stock_loss_adjustments" SET "transaction_date" = "audited_at"::date WHERE "transaction_date" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ALTER COLUMN "transaction_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "whole_sell_transactions" ADD COLUMN "transaction_date" date;--> statement-breakpoint
UPDATE "whole_sell_transactions" SET "transaction_date" = "recorded_at"::date WHERE "transaction_date" IS NULL;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "transaction_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "whole_buy_transactions" ADD COLUMN "transaction_date" date;--> statement-breakpoint
UPDATE "whole_buy_transactions" SET "transaction_date" = "recorded_at"::date WHERE "transaction_date" IS NULL;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "transaction_date" SET NOT NULL;
