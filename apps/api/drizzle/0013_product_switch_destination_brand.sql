-- a switch now names both ends. Every switch recorded before this landed in the fungible pool by
-- construction, so 'NA' is the true historical value, not a filler default — hence backfill then
-- drop the default, so nothing new can be written without saying where it went.
ALTER TABLE "product_switch_adjustments" ADD COLUMN "to_brand_id" varchar NOT NULL DEFAULT 'NA';--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ALTER COLUMN "to_brand_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_to_brand_id_gold_brands_id_fk" FOREIGN KEY ("to_brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;
