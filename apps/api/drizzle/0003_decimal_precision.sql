-- Give every money and weight column a scale, so the database quantizes what it is given.
--
-- All 53 of these were bare `numeric` -- no precision, no scale -- read in drizzle's
-- `mode: 'number'`. That combination meant a derived figure went in as an unrounded double and
-- stayed there: `weightGb * pricePerGb` for 15.2 gold baht at 40,350.10 THB is 613321.5199999999,
-- and that is what `total_amount` held. Two decimals of display formatting hid it on screen while
-- the residue sat on the row and accumulated through the weighted-average cost, which divides and
-- re-multiplies `total_cost` on every outbound movement.
--
-- Scales, from `packages/types/src/decimal.ts` and applied through the helpers in
-- `db/schema/columns.ts` so the convention cannot be half-applied:
--
--   numeric(18,2)   THB. 16 integer digits, far past any figure the shop can transact.
--   numeric(16,6)   gold baht and grams. Six decimals is one microgram. It is six rather than two
--                   because the brand split already worked to six, and its correctness argument
--                   depends on it -- the residual line is computed by subtraction, so the named
--                   lines and the remainder only reconstruct the transaction weight exactly if
--                   both are rounded the same way.
--   numeric(6,4)    grams per gold baht, matching `unit_conversion.factor_value`, which the
--                   transaction tables snapshot. The copy is now declared by the same helper as
--                   the original, so the two cannot drift.
--
-- `purities.percent` is left at numeric(5,2): it is a percentage, not an amount or a weight.
--
-- **This rounds existing rows.** Postgres rounds half away from zero when narrowing a numeric, and
-- that is deliberate here -- any stored digit beyond these scales is float residue, not a figure
-- anybody entered. The application rounds identically before writing (`roundMoney`/`roundWeight`,
-- verified against Postgres over 38,002 values), so from here on the value the app holds and the
-- value on the row are the same number.
--
-- If a statement fails with "numeric field overflow", a row holds a figure larger than the
-- precision allows. Do not widen the column to get past it: find the row and establish whether the
-- amount is real, because at 16 integer digits it almost certainly is not.
--
--   SELECT id, total_amount FROM whole_buy_transactions WHERE abs(total_amount) >= 1e16;

ALTER TABLE "inventory_balance" ALTER COLUMN "total_weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "inventory_balance" ALTER COLUMN "total_weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "inventory_balance" ALTER COLUMN "total_cost" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "weight_gb_delta" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "weight_gm_delta" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "cost_delta" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ALTER COLUMN "from_cost_delta" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ALTER COLUMN "to_cost_delta" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "price_per_gb" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "total_cost" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "price_per_gb" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "total_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ALTER COLUMN "operation_fee" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "price_per_gb" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "total_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ALTER COLUMN "operation_fee" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "price_per_gb" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "price_per_gb_999" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "total_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "actual_weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "actual_weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "actual_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ALTER COLUMN "settled_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "price_per_gb" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "price_per_gb_999" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "total_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "actual_weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "actual_weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "actual_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ALTER COLUMN "settled_amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "received_transactions" ALTER COLUMN "weight_gb" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "received_transactions" ALTER COLUMN "weight_gm" SET DATA TYPE numeric(16, 6);--> statement-breakpoint
ALTER TABLE "received_transactions" ALTER COLUMN "conversion_factor" SET DATA TYPE numeric(6, 4);--> statement-breakpoint
ALTER TABLE "received_transactions" ALTER COLUMN "total_cost" SET DATA TYPE numeric(18, 2);