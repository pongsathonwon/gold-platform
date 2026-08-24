-- Retail becomes a manual write-up layer.
--
-- Both retail tables were built in 0000 as a *sync target* for a legacy POS, and were never used:
-- they hold zero rows. That POS integration is blocked on an unfinished document, and the shop
-- needs retail figures in the system now to compare buy against sell across all four transaction
-- domains. So the tables are reshaped for a human writing up a trade that already happened.
--
-- The sync-only columns are DROPPED rather than relaxed to nullable. A column whose only filler is
-- a service that does not exist reads as data someone forgot to populate, and re-adding it when the
-- sync service is built is a migration either way. Dropping is free here precisely because the
-- tables are empty — the same reason `transaction_date NOT NULL` needs no backfill.
--
-- Neither status enum is touched. `DRAFT` on both and `SHIPPED` on sell stay as values but become
-- unreachable through the shared transition map: a write-up lands directly on `CONFIRMED`, and the
-- inventory decrement that used to hang off `SHIPPED` is removed (retail moves no stock — stock is
-- adjusted manually via /inventory/gain|loss). Both come back by adding a transition, not a
-- migration. The `currentStatus` default moves to `CONFIRMED` to match.

ALTER TABLE "retail_buy_transactions" DROP COLUMN "buy_numb";--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" DROP COLUMN "cust_code";--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" DROP COLUMN "empl_code";--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" DROP COLUMN "brand_text";--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" DROP COLUMN "size_text";--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" DROP COLUMN "gold_price_snapshot";--> statement-breakpoint

ALTER TABLE "retail_sell_transactions" DROP COLUMN "sale_numb";--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" DROP COLUMN "cust_code";--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" DROP COLUMN "empl_code";--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" DROP COLUMN "brand_text";--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" DROP COLUMN "size_text";--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" DROP COLUMN "gold_price_snapshot";--> statement-breakpoint

-- The business day the deal happened, and the one the Fri–Thu settlement period is derived from.
-- Without it a backfilled week of trading would all land in the week it was typed up.
ALTER TABLE "retail_buy_transactions" ADD COLUMN "transaction_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD COLUMN "transaction_date" date NOT NULL;--> statement-breakpoint

-- Fees sit BESIDE the total, never inside it: `total_amount` stays weight_gb * price_per_gb so it
-- is directly comparable against the wholesale domains, which carry no fees at all.
ALTER TABLE "retail_buy_transactions" ADD COLUMN "operation_fee" numeric;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD COLUMN "operation_fee" numeric;--> statement-breakpoint

ALTER TABLE "retail_buy_transactions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD COLUMN "notes" text;--> statement-breakpoint

-- Marks how a row arrived, so a later POS feed is distinguishable from what was typed in by hand.
ALTER TABLE "retail_buy_transactions" ADD COLUMN "source" varchar DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD COLUMN "source" varchar DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint

-- Brand keys an inventory pool, and retail no longer touches one. Left on the table for a future
-- coupling, but nothing may depend on it being present.
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "brand_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "brand_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "retail_buy_transactions" ALTER COLUMN "current_status" SET DEFAULT 'CONFIRMED';--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "current_status" SET DEFAULT 'CONFIRMED';--> statement-breakpoint

-- `branches` is the required counterparty-side FK on both retail tables and has never held a row,
-- so nothing could be inserted at all. It gains the instant the row was written and a tombstone.
--
-- `deleted_at` rather than a hard delete, because once transactions reference a branch, deleting it
-- is impossible. It is distinct from the existing `active`, which is the reversible "not trading
-- right now": a closed branch still has to resolve its name on every transaction it ever recorded.
--
-- There is deliberately no opening-date column. The shop's branch export carries one, but it is
-- empty for the thirteen oldest branches and nothing reads it — a column that is a third unknown
-- and answers no question is worse than its absence.
ALTER TABLE "branches" ADD COLUMN "inserted_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "deleted_at" timestamp;
