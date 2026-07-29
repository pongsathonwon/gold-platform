ALTER TABLE "stock_gain_adjustments" ADD COLUMN "price_per_gb" numeric;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD COLUMN "reference_type" varchar;--> statement-breakpoint
UPDATE "stock_gain_adjustments" SET "price_per_gb" = COALESCE("total_cost" / NULLIF("weight_gb", 0), 0) WHERE "price_per_gb" IS NULL;--> statement-breakpoint
UPDATE "stock_gain_adjustments" SET "reference_type" = CASE "reason" WHEN 'correction' THEN 'MANUAL_CORRECTION' ELSE 'STOCK_COUNT' END WHERE "reference_type" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "price_per_gb" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ALTER COLUMN "reference_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD COLUMN "reference_type" varchar;--> statement-breakpoint
UPDATE "stock_loss_adjustments" SET "reference_type" = CASE "reason" WHEN 'damage' THEN 'DAMAGE' WHEN 'lost' THEN 'LOST' WHEN 'correction' THEN 'MANUAL_CORRECTION' ELSE 'STOCK_COUNT' END WHERE "reference_type" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ALTER COLUMN "reference_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" DROP COLUMN "reason";--> statement-breakpoint
DROP TYPE "public"."gain_reason";--> statement-breakpoint
DROP TYPE "public"."loss_reason";
